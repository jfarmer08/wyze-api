"use strict";

/**
 * GUTES frame builders — construct outgoing frames.
 *
 * Ported from cryze (src/relay/frame_builder.py). This module covers
 * the **primitives** (`nextSqnum`, `computeChkval`, `encryptServerId`,
 * `makeServerChkval`) and the simplest **frame builders** (KEEPALIVE,
 * KEEPALIVE_ACK). The relay-server response builders (DETECT_RESP,
 * CERTIFY_RESP, CALLING_ACK, MTP_RES_RESP, LIST_RESP, etc.) are
 * intentionally NOT included here — they're 500+ lines of
 * state-tracking that we don't need for the Phase 0 spike. Port them
 * in a follow-up when we actually need to act as a relay.
 *
 * What's here is enough to:
 *   - Construct KEEPALIVE frames to keep an established session warm
 *   - Compute checksums correctly so the SDK accepts our frames
 *   - Encrypt server-side term_ids identically to the reference impl
 *
 * No filesystem or network I/O. Pure construction given the state
 * object the caller passes in.
 */

const crypto = require("crypto");
const { RC5, idEncrypt } = require("./rc5");
const { TYPES, HEADER_SIZE, PROTOCOL } = require("./constants");

/**
 * Minimal relay state shape required by these builders.
 *
 * Callers can use any object that exposes these fields. We pass it
 * through unmodified — only `server_sqnum` is read/incremented.
 *
 * @typedef {Object} RelayState
 * @property {bigint} server_term_id - our 64-bit identity
 * @property {number} server_sqnum   - monotonic sequence counter (0..2^32-1)
 * @property {number} t0             - process start time in ms (perf.now() origin)
 */

/**
 * Increment the relay's sqnum and return the previous value. Wraps at
 * 2^32. Matches Python's `(x + 1) & 0xFFFFFFFF`.
 */
function nextSqnum(relay) {
  const sq = relay.server_sqnum >>> 0;
  relay.server_sqnum = (sq + 1) >>> 0;
  return sq;
}

/**
 * Generate a chkval for server-built frames. Cryze uses MD5 of the
 * little-endian sqnum and takes the first 4 bytes as a uint32. Not a
 * security primitive — just a deterministic "anything but zero" value
 * that the SDK accepts.
 */
function makeServerChkval(sqnum) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(sqnum >>> 0, 0);
  const hash = crypto.createHash("md5").update(buf).digest();
  return hash.readUInt32LE(0);
}

/**
 * Encrypt a 64-bit server term_id for placement in a frame header.
 * Mirrors idEncrypt() but accepts the term_id as a BigInt and packs
 * to little-endian bytes first.
 *
 * @param {bigint} serverTermId
 * @param {number} sqnum
 * @param {number} chkval
 * @returns {Buffer} 8-byte encrypted ID
 */
function encryptServerId(serverTermId, sqnum, chkval) {
  const idBytes = Buffer.alloc(8);
  // Accept both signed and unsigned BigInts — mask to 64-bit two's
  // complement and write as unsigned. The on-wire bytes are identical
  // either way; only JS's read interpretation differs. The matching
  // reader (parseFrame) uses readBigInt64LE which returns the signed
  // view of the same bytes.
  idBytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(serverTermId)), 0);
  const chkvalBytes = Buffer.alloc(4);
  chkvalBytes.writeUInt32LE(chkval >>> 0, 0);
  const sqnumBytes = Buffer.alloc(4);
  sqnumBytes.writeUInt32LE(sqnum >>> 0, 0);
  return idEncrypt(idBytes, chkvalBytes, sqnumBytes);
}

/**
 * Compute the frame checksum exactly as `iv_gute_frm_init_chkval` in
 * the SDK does (libiotp2pav.c:17589):
 *
 *   d[i] = uint32 little-endian dword at byte offset i*4
 *   chk  = (d[5] & 0x00FFFFFF) ^ d[0] ^ d[1] ^ d[2] ^ d[3]
 *   for i = 6..len(d)-1:  chk ^= d[i]
 *
 * Header layout in dword indices:
 *   d[0] = bytes 0..3   (protocol + type + frm_len)
 *   d[1] = bytes 4..7   (term_id low half)
 *   d[2] = bytes 8..11  (term_id high half)
 *   d[3] = bytes 12..15 (sqnum)
 *   d[4] = bytes 16..19 (chkval — **excluded from the calculation**)
 *   d[5] = bytes 20..23 (opt_flags — top byte masked off)
 *   d[6+] = payload dwords
 *
 * Frame length should already be aligned to 4 bytes when this is
 * called. If it isn't, trailing bytes < 4 are ignored.
 */
function computeChkval(frame) {
  const fullDwords = Math.floor(frame.length / 4);
  if (fullDwords < 6) return 0;
  const d = new Array(fullDwords);
  for (let i = 0; i < fullDwords; i++) {
    d[i] = frame.readUInt32LE(i * 4);
  }
  let chk = (d[5] & 0x00FFFFFF) ^ d[0] ^ d[1] ^ d[2] ^ d[3];
  for (let i = 6; i < fullDwords; i++) chk ^= d[i];
  return chk >>> 0;
}

/**
 * Construct a KEEPALIVE frame (type 0x17, header-only — no payload).
 *
 * Used to keep an established session warm. qos=1 (need-ack) so the
 * peer will respond with a KEEPALIVE_ACK, which is what we use as the
 * "is the session still alive" signal.
 *
 * @param {RelayState} relay
 * @returns {Buffer} 28-byte frame
 */
function buildKeepalive(relay) {
  const frame = Buffer.alloc(HEADER_SIZE);
  frame[0] = PROTOCOL.RELAY;
  frame[1] = TYPES.KEEPALIVE;
  frame.writeUInt16LE(HEADER_SIZE, 2);

  const sqnum = nextSqnum(relay);
  const chkval = makeServerChkval(sqnum);
  const encryptedId = encryptServerId(relay.server_term_id, sqnum, chkval);
  encryptedId.copy(frame, 4);
  frame.writeUInt32LE(sqnum, 0x0C);
  frame.writeUInt32LE(chkval, 0x10);

  // opt_flags: qos=1 (need-ack, bit 18) + random nonce in bits 1..15
  const nonce = Math.floor(Math.random() * 0x8000);
  const optFlags = ((nonce << 1) | (1 << 18)) >>> 0;
  frame.writeUInt32LE(optFlags, 0x14);

  frame.writeUInt16LE(0, 0x18); // flags2
  frame.writeUInt16LE(0, 0x1A); // ack_result
  return frame;
}

/**
 * Build a KEEPALIVE ACK in response to a peer's KEEPALIVE. Echoes the
 * request's sqnum in our response (so the peer can match the ack to
 * its outstanding request) and sets opt_ack=1 (bit 20).
 *
 * @param {RelayState} relay
 * @param {Buffer} requestData — the inbound KEEPALIVE frame
 * @returns {Buffer|null}
 */
function buildKeepaliveAck(relay, requestData) {
  if (!Buffer.isBuffer(requestData) || requestData.length < HEADER_SIZE) return null;

  const ack = Buffer.alloc(HEADER_SIZE);
  ack[0] = requestData[0]; // mirror the incoming protocol byte (0x7E or 0x7F)
  ack[1] = TYPES.KEEPALIVE;
  ack.writeUInt16LE(HEADER_SIZE, 2);

  const sqnum = requestData.readUInt32LE(0x0C); // echo
  const chkval = 0;
  const encryptedId = encryptServerId(relay.server_term_id, sqnum, chkval);
  encryptedId.copy(ack, 4);
  ack.writeUInt32LE(sqnum, 0x0C);
  ack.writeUInt32LE(chkval, 0x10);

  const nonce = Math.floor(Math.random() * 0x8000);
  const optFlags = ((nonce << 1) | (1 << 20)) >>> 0; // opt_ack=1
  ack.writeUInt32LE(optFlags, 0x14);
  ack.writeUInt16LE(0, 0x18);
  ack.writeUInt16LE(0, 0x1A);
  return ack;
}

module.exports = {
  nextSqnum,
  makeServerChkval,
  encryptServerId,
  computeChkval,
  buildKeepalive,
  buildKeepaliveAck,
};

// ---- Self-test ---------------------------------------------------------

if (require.main === module) {
  const { parseFrame } = require("./frame");

  let ok = true;
  function check(label, cond) {
    console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
    if (!cond) ok = false;
  }

  // nextSqnum wraps at 2^32 and increments correctly.
  {
    const state = { server_term_id: 1n, server_sqnum: 0xFFFFFFFE, t0: 0 };
    check(`nextSqnum(0xFFFFFFFE) = 0xFFFFFFFE`, nextSqnum(state) === 0xFFFFFFFE);
    check(`nextSqnum(0xFFFFFFFF) = 0xFFFFFFFF`, nextSqnum(state) === 0xFFFFFFFF);
    check(`nextSqnum wrapped → 0`, nextSqnum(state) === 0);
    check(`state advanced past wrap`, state.server_sqnum === 1);
  }

  // makeServerChkval is deterministic.
  {
    const a = makeServerChkval(42);
    const b = makeServerChkval(42);
    check(`makeServerChkval deterministic`, a === b);
  }

  // computeChkval matches a known value computed by the Python reference.
  {
    const frame = Buffer.alloc(0x20);
    frame[0] = 0x7F;
    frame[1] = 0x17;
    frame.writeUInt16LE(0x20, 2);
    frame.writeBigUInt64LE(0x0807060504030201n, 4);
    frame.writeUInt32LE(0x12345678, 0x0C);
    frame.writeUInt32LE(0xDEADBEEF, 0x10);
    frame.writeUInt32LE(0x00010002, 0x14);
    // d[6] is bytes 0x18..0x1B (flags2 + ack_result)
    frame.writeUInt16LE(0, 0x18);
    frame.writeUInt16LE(0, 0x1A);
    frame.writeUInt32LE(0xCAFEBABE, 0x1C);
    const chk = computeChkval(frame);
    // Reproduce Python: chk = (d5 & 0xFFFFFF) ^ d0 ^ d1 ^ d2 ^ d3 ^ d6 ^ d7
    // where d4 (chkval) is intentionally skipped
    const d0 = frame.readUInt32LE(0x00);
    const d1 = frame.readUInt32LE(0x04);
    const d2 = frame.readUInt32LE(0x08);
    const d3 = frame.readUInt32LE(0x0C);
    const d5 = frame.readUInt32LE(0x14);
    const d6 = frame.readUInt32LE(0x18);
    const d7 = frame.readUInt32LE(0x1C);
    const expected = ((d5 & 0x00FFFFFF) ^ d0 ^ d1 ^ d2 ^ d3 ^ d6 ^ d7) >>> 0;
    check(`computeChkval matches reference formula`, chk === expected);
  }

  // buildKeepalive produces a parseable header with the right type + length.
  {
    const state = { server_term_id: 0x1234567890ABCDEFn, server_sqnum: 100, t0: 0 };
    const frame = buildKeepalive(state);
    check(`KEEPALIVE length = ${HEADER_SIZE}`, frame.length === HEADER_SIZE);
    check(`first byte = PROTOCOL.RELAY`, frame[0] === PROTOCOL.RELAY);
    check(`type = KEEPALIVE`, frame[1] === TYPES.KEEPALIVE);
    check(`frm_len = HEADER_SIZE`, frame.readUInt16LE(2) === HEADER_SIZE);
    const parsed = parseFrame(frame);
    check(`round-trips through parseFrame`, parsed !== null);
    check(`parsed sqnum = 100`, parsed.sqnum === 100);
    check(`parsed termId decrypts to 0x1234567890ABCDEF`,
      parsed.termId === 0x1234567890ABCDEFn);
    check(`parsed qos = 1 (need-ack)`, parsed.qos === 1);
  }

  // buildKeepaliveAck echoes the inbound sqnum and marks opt_ack=1.
  {
    const state = { server_term_id: 0xCAFEn, server_sqnum: 0, t0: 0 };
    const inboundKa = buildKeepalive({ server_term_id: 0xDEADBEEFn, server_sqnum: 555, t0: 0 });
    const ack = buildKeepaliveAck(state, inboundKa);
    check(`ACK length = ${HEADER_SIZE}`, ack.length === HEADER_SIZE);
    const parsed = parseFrame(ack);
    check(`ACK echoes inbound sqnum (555)`, parsed.sqnum === 555);
    check(`ACK marks opt_ack=1`, parsed.isAck === true);
  }

  console.log(ok ? "\nAll builder self-tests passed." : "\nFAILURES present.");
  process.exit(ok ? 0 : 1);
}
