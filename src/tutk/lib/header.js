"use strict";

/**
 * TutkWyzeProtocolHeader — 16-byte header that prefixes every Tutk
 * Wyze protocol message.
 *
 * Layout (all little-endian, _pack_=1):
 *
 *   Offset  Size  Field
 *   0x00    2     prefix       — always ASCII "HL"
 *   0x02    2     protocol     — version field, always 5 in cryze/dwb's experience
 *   0x04    2     code         — 2-byte command code (K10000, K10002, …)
 *   0x06    4     txt_len      — payload length (uint32, but encode() only fills the low 2 bytes)
 *   0x0A    2     reserved2    — always 0 on wire
 *   0x0C    4     reserved3    — always 0 on wire
 *
 * Notes on the txt_len field: the Python struct definition declares it
 * as uint32 at offset 6..10, but the matching `encode()` helper packs
 * it as uint16 followed by 8 padding bytes. On the wire the high two
 * bytes are always zero. We follow the same convention here — write
 * as uint16, read as uint32 (which captures the trailing zeros).
 *
 * Ported from docker-wyze-bridge `app/wyzecam/tutk/tutk_protocol.py`.
 */

const { PREFIX, PROTOCOL_VERSION, HEADER_SIZE } = require("./constants");

class TutkWyzeProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "TutkWyzeProtocolError";
  }
}

/**
 * Pack a 16-byte header for `code` with a payload of `txtLen` bytes.
 *
 * @param {number} code — 2-byte command code (uint16)
 * @param {number} txtLen — payload length in bytes
 * @param {number} [protocol=5] — protocol version override (advanced)
 * @returns {Buffer} 16 bytes
 */
function packHeader(code, txtLen, protocol = PROTOCOL_VERSION) {
  const buf = Buffer.alloc(HEADER_SIZE);
  PREFIX.copy(buf, 0);
  buf.writeUInt16LE(protocol & 0xFFFF, 2);
  buf.writeUInt16LE(code & 0xFFFF, 4);
  buf.writeUInt16LE(txtLen & 0xFFFF, 6);
  // Bytes 8..15 stay zero (reserved fields).
  return buf;
}

/**
 * Parse a 16-byte header. Returns a plain object; throws
 * TutkWyzeProtocolError on bad inputs (too short, wrong prefix).
 *
 * @param {Buffer} buf — at least 16 bytes; only the first 16 are read
 * @returns {{prefix: string, protocol: number, code: number, txt_len: number}}
 */
function unpackHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) {
    throw new TutkWyzeProtocolError(
      `header too short: need ${HEADER_SIZE} bytes, got ${buf?.length ?? 0}`
    );
  }
  const prefix = buf.subarray(0, 2).toString("ascii");
  if (prefix !== "HL") {
    throw new TutkWyzeProtocolError(
      `IOCtrl message should begin with the prefix 'HL', got ${JSON.stringify(prefix)}`
    );
  }
  return {
    prefix,
    protocol: buf.readUInt16LE(2),
    code: buf.readUInt16LE(4),
    // Read full uint32 to match the Python struct definition. In
    // practice the high uint16 is always zero on the wire (encode()
    // doesn't fill it) so this is equivalent to readUInt16LE(6).
    txt_len: buf.readUInt32LE(6),
    reserved2: buf.readUInt16LE(10),
    reserved3: buf.readUInt32LE(12),
  };
}

module.exports = {
  TutkWyzeProtocolError,
  packHeader,
  unpackHeader,
};
