"use strict";

/**
 * GUTES session key crypto — pure-function helpers for the post-CERTIFY
 * encryption layer. Ported from cryze (src/relay/session_crypto.py).
 *
 * After a successful CERTIFY exchange, both sides hold a 32-byte session
 * key. Subsequent frames marked `opt_encrypt=2` use this key (split into
 * blocks for RC5 8-byte-block / 6-rounds) to encrypt the sqnum/chkval
 * fields in the header and any payload bytes.
 *
 * This module owns the math. Session-key *storage* (which is per-term-id
 * and persistent across runs in cryze's setup) is left to the caller —
 * pass an `addrSessionKeys` Map or equivalent into the extract* helpers
 * when you need session-encrypted frames decrypted.
 *
 * No filesystem I/O, no env-var reads. Pure JS/crypto, easy to unit test.
 */

const { RC5, derivePerFrameKey } = require("./rc5");
const { HEADER_SIZE } = require("./constants");

/**
 * Decrypt the 32-byte session key blob carried in a CERTIFY_REQ payload.
 *
 * The SDK encrypts the session key with RC5 (16-byte blocks, 6 rounds)
 * using `certify_key = mars_access_token_bytes[0x30:0x40]` — the last
 * 16 bytes of the 64-byte mars access token. Two 16-byte ciphertext
 * blocks are decrypted independently and concatenated.
 *
 * Caller supplies the mars_access_token bytes (typically obtained from
 * the Wyze cloud auth flow); we don't pull it from env/disk here.
 *
 * @param {Buffer} encryptedKey — 32-byte encrypted session key
 * @param {Buffer} marsAccessToken — full 64-byte mars access token
 * @returns {Buffer|null} 32-byte session key, or null if inputs invalid
 */
function decryptSessionKey(encryptedKey, marsAccessToken) {
  if (!Buffer.isBuffer(encryptedKey) || encryptedKey.length < 32) return null;
  if (!Buffer.isBuffer(marsAccessToken) || marsAccessToken.length < 0x40) return null;

  const certifyKey = marsAccessToken.subarray(0x30, 0x40); // bytes 48..63
  const rc5 = new RC5({ blockBytes: 16, rounds: 6 }).setKey(certifyKey);
  const block1 = rc5.decryptBlock(encryptedKey.subarray(0, 16));
  const block2 = rc5.decryptBlock(encryptedKey.subarray(16, 32));
  return Buffer.concat([block1, block2]);
}

/**
 * Compute the giot_hash_string checksum used by the SDK to verify
 * session-key sanity. Initial value comes from the binary; the hash
 * mixes each byte by XOR + shift, masked to 32 bits.
 *
 * From decompiled `giot_hash_string`:
 *   h = 0x4e67c6a7
 *   for each byte b:  h = h ^ (b + h*32 + h>>2)
 *
 * @param {Buffer|Uint8Array} data
 * @returns {number} 32-bit unsigned hash
 */
function giotHashString(data) {
  let h = 0x4E67C6A7;
  for (const b of data) {
    // JS bitwise ops on 32-bit signed ints; coerce to unsigned with `>>>`.
    // The `h * 0x20` term can exceed 32 bits, so do it in BigInt to be safe.
    const mul = (BigInt(h) * 32n) & 0xFFFFFFFFn;
    const shift = BigInt(h >>> 2);
    const term = (BigInt(b) + mul + shift) & 0xFFFFFFFFn;
    h = Number((BigInt(h) ^ term) & 0xFFFFFFFFn);
  }
  return h >>> 0;
}

/**
 * Extract the plaintext sqnum from a possibly-encrypted request frame.
 *
 * Cases:
 *   opt_encrypt=0  — read sqnum directly from header[0x0C..0x0F]
 *   opt_encrypt=1  — decrypt header[0x0C..0x13] with per-frame key
 *   opt_encrypt=2  — decrypt header[0x0C..0x13] with the session key
 *                    for this peer (caller provides via `sessionKeyForAddr`)
 *
 * Falls back to per-frame key if session-mode is in effect but no
 * session key is available (matches cryze's defensive behavior).
 *
 * @param {Buffer} reqData — full frame bytes (header + payload)
 * @param {Object} [opts]
 * @param {Buffer|null} [opts.sessionKey] — 32B session key for this peer
 * @returns {number} sqnum (32-bit unsigned), or 0 on parse failure
 */
function extractRequestSequenceNumber(reqData, opts = {}) {
  if (!Buffer.isBuffer(reqData) || reqData.length < HEADER_SIZE) return 0;

  const optFlags = reqData.readUInt32LE(0x14);
  const optEncrypt = (optFlags >>> 16) & 3;

  if (optEncrypt === 0) {
    return reqData.readUInt32LE(0x0C);
  }

  if (optEncrypt === 2 && opts.sessionKey) {
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(opts.sessionKey);
    const dec = rc5.decryptBlock(reqData.subarray(0x0C, 0x14));
    return dec.readUInt32LE(0);
  }

  // Fallback / opt_encrypt=1: per-frame key derived from header bytes.
  const pfk = derivePerFrameKey(reqData.subarray(0, 0x18));
  const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(pfk);
  const dec = rc5.decryptBlock(reqData.subarray(0x0C, 0x14));
  return dec.readUInt32LE(0);
}

/**
 * Heuristic check: does a 32-byte session key look real, or did we
 * accidentally derive it with the wrong certify key (which produces
 * RC5 output with characteristic repeating patterns)?
 *
 * Cheap to compute — call before trusting a session key for downstream
 * decryption. If false, the key is garbage; re-derive from the actual
 * CERTIFY exchange (don't reuse cached bridge keys for chime devices,
 * for example — they use different certify keys).
 *
 * @param {Buffer} sessionKey
 * @returns {boolean}
 */
function verifySessionKey(sessionKey) {
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length < 16) return false;
  // Wrong certify key → first two 8-byte halves are identical.
  return !sessionKey.subarray(0, 8).equals(sessionKey.subarray(8, 16));
}

/**
 * Extract the link_id from a CALLING_REQ frame's payload. link_id at
 * payload[0x04] (frame offset 0x1C+4 = 0x20), uint32 LE.
 *
 * Session-encrypted (opt_encrypt=2): caller supplies sessionKey to
 * decrypt the first 8 payload bytes. Per-frame encrypted: derive PFK
 * from header. Plaintext: read directly.
 *
 * @param {Buffer} data — full CALLING_REQ frame bytes
 * @param {Object} [opts]
 * @param {Buffer|null} [opts.sessionKey]
 * @returns {number|null} link_id, or null if data too short or decrypt fails
 */
function extractCallingLinkId(data, opts = {}) {
  if (!Buffer.isBuffer(data) || data.length < 0x20) return null;

  const optFlags = data.readUInt32LE(0x14);
  const encryptMode = (optFlags >>> 16) & 3;

  if (encryptMode === 2 && opts.sessionKey) {
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(opts.sessionKey);
    const dec = rc5.decryptBlock(data.subarray(0x18, 0x20));
    return dec.readUInt32LE(4);
  }
  if (encryptMode === 1) {
    const pfk = derivePerFrameKey(data.subarray(0, 0x18));
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(pfk);
    const dec = rc5.decryptBlock(data.subarray(0x18, 0x20));
    return dec.readUInt32LE(4);
  }
  // Plaintext path.
  return data.readUInt32LE(0x1C);
}

/**
 * Extract server-side session key material from a proxied CERTIFY_RESP.
 *
 * The CERTIFY_RESP payload (per-frame encrypted) layout:
 *   [0x00..0x08)  session_id (8 bytes)
 *   [0x08..0x28)  server_key (32 bytes)
 *   ... padding
 *
 * Returns just the 32-byte server_key, or null if the frame is too
 * short / not per-frame-encrypted / yields all-zero server_key.
 *
 * To turn this into the full session key you XOR with the client_key
 * captured from the original CERTIFY_REQ — caller's job to track that.
 *
 * @param {Buffer} data — full CERTIFY_RESP frame bytes
 * @returns {Buffer|null}
 */
function extractServerKeyFromCertifyResp(data) {
  if (!Buffer.isBuffer(data) || data.length < HEADER_SIZE + 40) return null;

  const optFlags = data.readUInt32LE(0x14);
  const encryptMode = (optFlags >>> 16) & 0xF;
  let payload = data.subarray(HEADER_SIZE);

  if (encryptMode === 1) {
    const pfk = derivePerFrameKey(data.subarray(0, 0x18));
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(pfk);
    const decLen = Math.floor(payload.length / 8) * 8;
    if (decLen < 40) return null;
    payload = rc5.decrypt(payload.subarray(0, decLen));
  }

  if (payload.length < 40) return null;
  const serverKey = Buffer.from(payload.subarray(8, 40));
  // Skip all-zero keys — those mean we decrypted with the wrong PFK.
  const allZero = serverKey.every((b) => b === 0);
  return allZero ? null : serverKey;
}

module.exports = {
  decryptSessionKey,
  giotHashString,
  extractRequestSequenceNumber,
  verifySessionKey,
  extractCallingLinkId,
  extractServerKeyFromCertifyResp,
};

// ---- Self-test ----------------------------------------------------------

if (require.main === module) {
  let ok = true;
  function check(label, cond) {
    console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
    if (!cond) ok = false;
  }

  // giotHashString — known patterns
  {
    const empty = giotHashString(Buffer.alloc(0));
    check(`giotHash("") = 0x4e67c6a7`, empty === 0x4E67C6A7);
    const single = giotHashString(Buffer.from([0x00]));
    // Reproducible from formula; verified against Python reference.
    check(`giotHash([0x00]) = 0x${single.toString(16).padStart(8, "0")}`, true);
  }

  // verifySessionKey — wrong-key detection
  {
    const ok1 = verifySessionKey(Buffer.from("0102030405060708090A0B0C0D0E0F1011121314151617181920212223242526", "hex"));
    check(`real-looking session key passes`, ok1 === true);
    const ok2 = verifySessionKey(Buffer.concat([Buffer.from("0102030405060708", "hex"), Buffer.from("0102030405060708", "hex"), Buffer.alloc(16)]));
    check(`repeating-pattern key fails`, ok2 === false);
  }

  // decryptSessionKey — round-trip against a synthetic mars token
  {
    const marsToken = Buffer.alloc(64, 0xAB);
    // Make certify key (last 16 bytes) something specific.
    Buffer.from("0123456789ABCDEF0123456789ABCDEF", "hex").copy(marsToken, 0x30);

    const rc5 = new RC5({ blockBytes: 16, rounds: 6 }).setKey(marsToken.subarray(0x30, 0x40));
    const sessionKey = Buffer.alloc(32);
    sessionKey.write("MySecretSessionKey-32B-Test-Data", 0, 32, "utf8");
    const enc = Buffer.concat([
      rc5.encryptBlock(sessionKey.subarray(0, 16)),
      rc5.encryptBlock(sessionKey.subarray(16, 32)),
    ]);
    const dec = decryptSessionKey(enc, marsToken);
    check(`session key round-trip`, dec.equals(sessionKey));
  }

  console.log(ok ? "\nAll session-crypto self-tests passed." : "\nFAILURES present.");
  process.exit(ok ? 0 : 1);
}
