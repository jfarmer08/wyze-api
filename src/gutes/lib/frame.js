"use strict";

/**
 * GUTES frame parser — decodes the Gwell/IoTVideo P2P relay protocol
 * frames over UDP or TCP. Ported from cryze (src/relay/gutes_frame.py).
 *
 * Frame header (28 bytes, all little-endian):
 *
 *   Offset  Size  Field
 *   0x00    1     protocol (0x7F=relay, 0x7E=session, 0x70=fragment/broadcast)
 *   0x01    1     type (dispatch key — see constants.TYPES)
 *   0x02    2     frm_len (total frame length including header)
 *   0x04    8     term_id (64-bit device ID, RC5-encrypted)
 *   0x0C    4     sqnum (sequence number)
 *   0x10    4     chkval (checksum)
 *   0x14    4     opt_flags (bitfield, see below)
 *   0x18    2     flags2
 *   0x1A    2     ack_result
 *   0x1C+   var   payload (type-dependent)
 *
 * opt_flags bitfield:
 *   bit 0:      compressed
 *   bits 1-15:  random nonce
 *   bits 16-17: opt_encrypt (0=none, 1=per-frame key, 2=session key)
 *   bits 18-19: QoS (0=fire-forget, 1=ack, 3=ack+callback)
 *   bit 20:     is_ack
 *   bit 21:     is_response
 *   bit 22:     signature appended (HMAC-MD5, 16 bytes)
 *   bit 24:     ntp timestamp appended
 *   bit 25:     relay flag (passes through relay server)
 */

const { RC5, derivePerFrameKey, idDecrypt } = require("./rc5");
const { HEADER_SIZE, PROTOCOL, frameTypeName } = require("./constants");

// Sanity bound on frame size when scanning a stream buffer. Cryze uses
// 0x2800 (10240) — chosen as "well above any legitimate control frame,
// well below where the parser is at risk of consuming a runaway buffer
// on malformed input." Matches their value to stay protocol-faithful.
const MAX_FRAME_LEN = 0x2800;

/**
 * Parsed GUTES frame. Plain object with all decoded fields.
 */
class GutesFrame {
  constructor() {
    this.raw = Buffer.alloc(0);
    // Header fields
    this.protocol = 0;
    this.frameType = 0;
    this.frmLen = 0;
    this.termIdRaw = Buffer.alloc(0); // 8 bytes, still encrypted
    this.termId = 0n; // decrypted 64-bit ID (BigInt)
    this.sqnum = 0;
    this.chkval = 0;
    this.optFlags = 0;
    this.flags2 = 0;
    this.ackResult = 0;
    // Decoded opt_flags
    this.compressed = false;
    this.nonce = 0;
    this.optEncrypt = 0;
    this.qos = 0;
    this.isAck = false;
    this.isResponse = false;
    this.signatureAppended = false;
    this.ntpAppended = false;
    this.relayFlag = false;
    // Payload
    this.payload = Buffer.alloc(0);
    this.payloadDecrypted = null;
    // Metadata
    this.typeName = "";
    this.direction = ""; // "C->S" or "S->C", for log readability
  }

  headerHex() {
    return this.raw.length >= HEADER_SIZE
      ? this.raw.subarray(0, HEADER_SIZE).toString("hex")
      : this.raw.toString("hex");
  }

  /**
   * One-line summary for log output. Format matches cryze's exactly
   * so log diffs against the Python reference stay readable.
   */
  summary() {
    const encStr = ["none", "per-frame", "session", "?"][this.optEncrypt];
    const qosStr = ["fire", "ack", "?", "ack+cb"][this.qos];
    const flagBits = [];
    if (this.isAck) flagBits.push("ACK");
    if (this.isResponse) flagBits.push("RESP");
    if (this.relayFlag) flagBits.push("RELAY");
    if (this.signatureAppended) flagBits.push("SIG");
    if (this.ntpAppended) flagBits.push("NTP");
    if (this.compressed) flagBits.push("COMP");
    const flagsStr = flagBits.length > 0 ? flagBits.join("|") : "-";

    const typePad = this.typeName.padEnd(20).slice(0, 20);
    return `[${this.direction}] ${typePad} ` +
           `proto=0x${this.protocol.toString(16).padStart(2, "0").toUpperCase()} ` +
           `len=${String(this.frmLen).padStart(4)} ` +
           `id=${this.termId.toString().padEnd(20)} sq=${this.sqnum} ` +
           `enc=${encStr} qos=${qosStr} flags=${flagsStr}`;
  }
}

/**
 * Parse a single GUTES frame from raw bytes.
 *
 * @param {Buffer} data
 * @param {Object} [opts]
 * @param {string} [opts.direction] — "C->S" or "S->C" for logging
 * @param {Buffer} [opts.sessionKey] — 32-byte session key (for opt_encrypt=2)
 * @returns {GutesFrame|null}
 */
function parseFrame(data, opts = {}) {
  if (!Buffer.isBuffer(data) || data.length < HEADER_SIZE) return null;

  const f = new GutesFrame();
  f.raw = data;
  f.direction = opts.direction || "";

  f.protocol = data[0];
  f.frameType = data[1];
  f.frmLen = data.readUInt16LE(2);
  f.termIdRaw = Buffer.from(data.subarray(4, 12));
  f.sqnum = data.readUInt32LE(0x0C);
  f.chkval = data.readUInt32LE(0x10);
  f.optFlags = data.readUInt32LE(0x14);
  f.flags2 = data.readUInt16LE(0x18);
  f.ackResult = data.readUInt16LE(0x1A);

  // Decode opt_flags bitfield (see header comment).
  const of = f.optFlags;
  f.compressed         = (of & 1) !== 0;
  f.nonce              = (of >>> 1) & 0x7FFF;
  f.optEncrypt         = (of >>> 16) & 3;
  f.qos                = (of >>> 18) & 3;
  f.isAck              = ((of >>> 20) & 1) !== 0;
  f.isResponse         = ((of >>> 21) & 1) !== 0;
  f.signatureAppended  = ((of >>> 22) & 1) !== 0;
  f.ntpAppended        = ((of >>> 24) & 1) !== 0;
  f.relayFlag          = ((of >>> 25) & 1) !== 0;

  // Decrypt term_id. The XOR-with-sqnum/chkval step inside idDecrypt
  // makes this dependent on the actual header bytes, not just the
  // ciphertext, so we have to do it after parsing both fields.
  try {
    const sqnumBytes = Buffer.alloc(4);
    sqnumBytes.writeUInt32LE(f.sqnum, 0);
    const chkvalBytes = Buffer.alloc(4);
    chkvalBytes.writeUInt32LE(f.chkval, 0);
    const idBytes = idDecrypt(f.termIdRaw, chkvalBytes, sqnumBytes);
    // signed 64-bit — Python uses '<q' which is signed; preserve here.
    f.termId = idBytes.readBigInt64LE(0);
  } catch (_) {
    // Fall back to raw bytes interpreted as little-endian if decrypt fails.
    f.termId = f.termIdRaw.readBigInt64LE(0);
  }

  f.typeName = frameTypeName(f.frameType);

  // Extract payload — slice from end of header to declared frame length.
  // Frames in the wild are sometimes truncated; clamp to actual data length.
  const payloadStart = HEADER_SIZE;
  const payloadEnd = Math.min(f.frmLen, data.length);
  f.payload = Buffer.from(data.subarray(payloadStart, payloadEnd));

  // Best-effort payload decryption. Tail bytes that don't align to the
  // 8-byte cipher block are appended raw — matches cryze's behavior.
  if (f.optEncrypt === 1 && f.payload.length >= 8) {
    try {
      const pfk = derivePerFrameKey(data.subarray(0, 0x18));
      const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(pfk);
      const decLen = Math.floor(f.payload.length / 8) * 8;
      if (decLen > 0) {
        const head = rc5.decrypt(f.payload.subarray(0, decLen));
        f.payloadDecrypted = decLen < f.payload.length
          ? Buffer.concat([head, f.payload.subarray(decLen)])
          : head;
      }
    } catch (_) { /* leave payloadDecrypted null */ }
  } else if (f.optEncrypt === 2 && opts.sessionKey && f.payload.length >= 8) {
    try {
      const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(opts.sessionKey);
      const decLen = Math.floor(f.payload.length / 8) * 8;
      if (decLen > 0) {
        const head = rc5.decrypt(f.payload.subarray(0, decLen));
        f.payloadDecrypted = decLen < f.payload.length
          ? Buffer.concat([head, f.payload.subarray(decLen)])
          : head;
      }
    } catch (_) { /* leave payloadDecrypted null */ }
  } else if (f.optEncrypt === 0) {
    f.payloadDecrypted = f.payload;
  }

  return f;
}

/**
 * Try to extract one complete frame from a TCP stream buffer.
 *
 * Returns `{frame, consumed}` on success, `null` when more data is
 * needed, or `{frame: null, consumed: n}` when n bytes should be
 * discarded as garbage before retrying.
 *
 * The "discard" path handles desynced streams — e.g. a partial packet
 * dropped mid-flight, leaving the next valid frame at some offset > 0.
 * We scan for the next byte matching a known protocol value and tell
 * the caller to drop everything before it.
 */
function readFrameFromStream(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return null;

  // Garbage-byte handling.
  if (buf[0] !== PROTOCOL.RELAY && buf[0] !== PROTOCOL.SESSION && buf[0] !== PROTOCOL.BROADCAST) {
    for (let i = 1; i < buf.length; i++) {
      if (buf[i] === PROTOCOL.RELAY || buf[i] === PROTOCOL.SESSION || buf[i] === PROTOCOL.BROADCAST) {
        return { frame: null, consumed: i };
      }
    }
    // No valid protocol byte found at all — drop everything and wait.
    return { frame: null, consumed: buf.length };
  }

  const frmLen = buf.readUInt16LE(2);
  if (frmLen < HEADER_SIZE || frmLen > MAX_FRAME_LEN) {
    // Implausible length — drop just the first byte and re-scan.
    return { frame: null, consumed: 1 };
  }
  if (buf.length < frmLen) return null; // more data needed

  const frame = parseFrame(buf.subarray(0, frmLen));
  if (!frame) return { frame: null, consumed: 1 };
  return { frame, consumed: frmLen };
}

module.exports = {
  GutesFrame,
  parseFrame,
  readFrameFromStream,
  MAX_FRAME_LEN,
};

// ---- Self-test ----------------------------------------------------------

if (require.main === module) {
  const { TYPES } = require("./constants");

  // Build a synthetic CERTIFY frame and round-trip it through parseFrame.
  const data = Buffer.alloc(0x40);
  data[0] = PROTOCOL.RELAY;
  data[1] = TYPES.CERTIFY_REQ;
  data.writeUInt16LE(0x40, 2);
  data.writeBigUInt64LE(0x0102030405060708n, 4);
  data.writeUInt32LE(1, 0x0C);
  data.writeUInt32LE(2, 0x10);
  data.writeUInt32LE(0x00010000, 0x14); // opt_encrypt = 1 (per-frame)

  const f = parseFrame(data, { direction: "C->S" });
  console.log(f.summary());
  console.log(`  payload (${f.payload.length} bytes): ${f.payload.subarray(0, 32).toString("hex")}`);
  if (f.payloadDecrypted) {
    console.log(`  decrypted: ${f.payloadDecrypted.subarray(0, 32).toString("hex")}`);
  }

  // Stream-mode parser handles garbage + alignment.
  const garbage = Buffer.concat([Buffer.from([0xFF, 0xFE, 0xFD]), data]);
  const r = readFrameFromStream(garbage);
  console.log(`stream: consumed=${r.consumed} frame=${r.frame ? r.frame.typeName : "(skip)"}`);
  const r2 = readFrameFromStream(garbage.subarray(r.consumed));
  console.log(`stream2: consumed=${r2.consumed} frame=${r2.frame ? r2.frame.typeName : "(skip)"}`);

  console.log("Frame parser self-test OK.");
}
