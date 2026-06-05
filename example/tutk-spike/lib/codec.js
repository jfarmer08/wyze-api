"use strict";

/**
 * Top-level encode/decode for Tutk Wyze protocol messages.
 *
 * Mirrors the `encode(code, data)` and `decode(buf)` helpers in
 * docker-wyze-bridge's `app/wyzecam/tutk/tutk_protocol.py`.
 *
 *   encode(code, data) → [16B header | data...]
 *   decode(buf) → {header, payload}
 *
 * Validation matches the Python reference exactly: prefix must be
 * "HL", buffer length must equal header.txt_len + 16. Anything else
 * throws TutkWyzeProtocolError.
 */

const { packHeader, unpackHeader, TutkWyzeProtocolError } = require("./header");
const { HEADER_SIZE } = require("./constants");

/**
 * Encode a single message: write the 16-byte header for `code` with
 * the right txt_len, then concatenate the optional payload.
 *
 * @param {number} code
 * @param {Buffer|null|undefined} [data]
 * @returns {Buffer}
 */
function encode(code, data) {
  const payload = data || Buffer.alloc(0);
  const header = packHeader(code, payload.length);
  return Buffer.concat([header, payload], HEADER_SIZE + payload.length);
}

/**
 * Decode a complete message — header + payload. Strict: rejects
 * buffers whose length doesn't match the header's declared txt_len.
 *
 * @param {Buffer} buf
 * @returns {{header: object, payload: Buffer|null}}
 */
function decode(buf) {
  const header = unpackHeader(buf);
  const expected = header.txt_len + HEADER_SIZE;
  if (buf.length !== expected) {
    throw new TutkWyzeProtocolError(
      `Encoded length doesn't match message size ` +
      `(header says ${expected}, got message of len ${buf.length})`
    );
  }
  const payload = header.txt_len > 0
    ? Buffer.from(buf.subarray(HEADER_SIZE, expected))
    : null;
  return { header, payload };
}

module.exports = { encode, decode };
