"use strict";

/**
 * RC5 cipher implementation matching libiotp2pav.so (Gwell/IoTVideo P2P SDK).
 *
 * Ported from cryze (src/relay/rc5.py). The SDK uses RC5 in four
 * fixed configurations, identified by ctx slot in the binary:
 *
 *   ctx[0x26] — 8-byte block, 6 rounds, key="www.gwell.cc" — ID encryption
 *   ctx[0x27] — 8-byte block, 6 rounds, per-frame key (7 bytes from header)
 *   ctx[0x28] — 8-byte block, 6 rounds, 32-byte session key (post-certify)
 *   ctx[0x29] — 16-byte block, 6 rounds, 16-byte device secret (certify encryption)
 *
 * Implementation notes:
 * - JS bitwise ops are 32-bit signed. We work on `>>> 0` for 32-bit
 *   unsigned math, and use BigInt for the 16-byte block path (w=64).
 *   The 8-byte path stays on regular numbers (faster, no BigInt boxing).
 * - All multi-byte reads/writes are little-endian to match the SDK
 *   (and Python's '<II'/'<QQ' struct format).
 *
 * Self-tests at the bottom of the file double as documentation of
 * expected behavior. Run with `node lib/rc5.js`.
 */

// ---- 32-bit word path (8-byte block) ------------------------------------

const MASK32 = 0xFFFFFFFF;
const P32 = 0xB7E15163;
const Q32 = 0x9E3779B9;

function rotl32(val, n) {
  n &= 31;
  if (n === 0) return val >>> 0;
  return (((val << n) | (val >>> (32 - n))) >>> 0);
}

function rotr32(val, n) {
  n &= 31;
  if (n === 0) return val >>> 0;
  return (((val >>> n) | (val << (32 - n))) >>> 0);
}

// ---- 64-bit word path (16-byte block) — BigInt ---------------------------

const MASK64 = 0xFFFFFFFFFFFFFFFFn;
const P64 = 0xB7E151628AED2A6Bn;
const Q64 = 0x9E3779B97F4A7C15n;
const N63 = 63n;
const N64 = 64n;

function rotl64(val, n) {
  // n may be a regular number (always < 64); coerce to BigInt before mask
  const nb = BigInt(n) & N63;
  if (nb === 0n) return val & MASK64;
  return ((val << nb) | (val >> (N64 - nb))) & MASK64;
}

function rotr64(val, n) {
  const nb = BigInt(n) & N63;
  if (nb === 0n) return val & MASK64;
  return ((val >> nb) | (val << (N64 - nb))) & MASK64;
}

// ---- RC5 class -----------------------------------------------------------

class RC5 {
  /**
   * @param {Object} opts
   * @param {8|16} [opts.blockBytes=8] — 8 for w=32, 16 for w=64
   * @param {number} [opts.rounds=6] — SDK uses 6 everywhere
   */
  constructor({ blockBytes = 8, rounds = 6 } = {}) {
    if (blockBytes !== 8 && blockBytes !== 16) {
      throw new Error(`blockBytes must be 8 or 16, got ${blockBytes}`);
    }
    this.blockBytes = blockBytes;
    this.rounds = rounds;
    this.w = blockBytes === 8 ? 32 : 64;
    this.S = null; // expanded key schedule
  }

  /**
   * Expand a variable-length key into the round subkey table.
   * @param {Buffer|Uint8Array} keyBytes
   * @returns {RC5} this (for chaining)
   */
  setKey(keyBytes) {
    const isU8 = keyBytes instanceof Uint8Array;
    if (!isU8) throw new Error("key must be Uint8Array / Buffer");

    if (this.w === 32) {
      this.S = expandKey32(keyBytes, this.rounds);
    } else {
      this.S = expandKey64(keyBytes, this.rounds);
    }
    return this;
  }

  encryptBlock(plaintext) {
    if (plaintext.length !== this.blockBytes) {
      throw new Error(`encryptBlock: expected ${this.blockBytes} bytes, got ${plaintext.length}`);
    }
    if (!this.S) throw new Error("setKey() not called");
    return this.w === 32
      ? encryptBlock32(plaintext, this.S, this.rounds)
      : encryptBlock64(plaintext, this.S, this.rounds);
  }

  decryptBlock(ciphertext) {
    if (ciphertext.length !== this.blockBytes) {
      throw new Error(`decryptBlock: expected ${this.blockBytes} bytes, got ${ciphertext.length}`);
    }
    if (!this.S) throw new Error("setKey() not called");
    return this.w === 32
      ? decryptBlock32(ciphertext, this.S, this.rounds)
      : decryptBlock64(ciphertext, this.S, this.rounds);
  }

  /**
   * ECB-mode encrypt; data length must be a multiple of blockBytes.
   * No padding — cipher is used in a context where alignment is the
   * caller's job (frame headers, fixed-size keys, etc.).
   */
  encrypt(data) {
    if (data.length % this.blockBytes !== 0) {
      throw new Error(`encrypt: length ${data.length} not a multiple of ${this.blockBytes}`);
    }
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += this.blockBytes) {
      const block = this.encryptBlock(data.subarray(i, i + this.blockBytes));
      block.copy(out, i);
    }
    return out;
  }

  decrypt(data) {
    if (data.length % this.blockBytes !== 0) {
      throw new Error(`decrypt: length ${data.length} not a multiple of ${this.blockBytes}`);
    }
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += this.blockBytes) {
      const block = this.decryptBlock(data.subarray(i, i + this.blockBytes));
      block.copy(out, i);
    }
    return out;
  }
}

// ---- 32-bit key expansion + block crypt ---------------------------------

function expandKey32(keyBytes, rounds) {
  const u = 4; // bytes per word
  // Empty key → use a single zero byte (matches Python's b == 0 branch).
  let key = keyBytes;
  if (key.length === 0) key = Buffer.from([0]);

  const b = key.length;
  const c = Math.max(1, Math.ceil(b / u));
  const L = new Array(c).fill(0);

  // Little-endian: walk the key right-to-left so the lowest-index byte
  // ends up in the LSB of L[0].
  for (let i = b - 1; i >= 0; i--) {
    const wordIdx = (i / u) | 0;
    L[wordIdx] = (((L[wordIdx] << 8) >>> 0) + key[i]) >>> 0;
  }

  const t = 2 * (rounds + 1);
  const S = new Array(t);
  S[0] = P32 >>> 0;
  for (let i = 1; i < t; i++) S[i] = ((S[i - 1] + Q32) >>> 0);

  // The mixing pass — runs 3*max(t,c) times. Each iteration touches
  // one S entry and one L entry, rotating in the accumulated state.
  let A = 0, B = 0, i = 0, j = 0;
  const n = 3 * Math.max(t, c);
  for (let k = 0; k < n; k++) {
    A = S[i] = rotl32(((S[i] + A + B) >>> 0), 3);
    B = L[j] = rotl32(((L[j] + A + B) >>> 0), (A + B) >>> 0);
    i = (i + 1) % t;
    j = (j + 1) % c;
  }
  return S;
}

function encryptBlock32(input, S, rounds) {
  let A = input.readUInt32LE(0);
  let B = input.readUInt32LE(4);

  A = (A + S[0]) >>> 0;
  B = (B + S[1]) >>> 0;

  for (let i = 1; i <= rounds; i++) {
    A = (rotl32((A ^ B) >>> 0, B) + S[2 * i]) >>> 0;
    B = (rotl32((B ^ A) >>> 0, A) + S[2 * i + 1]) >>> 0;
  }

  const out = Buffer.alloc(8);
  out.writeUInt32LE(A, 0);
  out.writeUInt32LE(B, 4);
  return out;
}

function decryptBlock32(input, S, rounds) {
  let A = input.readUInt32LE(0);
  let B = input.readUInt32LE(4);

  for (let i = rounds; i > 0; i--) {
    B = (rotr32(((B - S[2 * i + 1]) >>> 0), A) ^ A) >>> 0;
    A = (rotr32(((A - S[2 * i]) >>> 0), B) ^ B) >>> 0;
  }

  B = (B - S[1]) >>> 0;
  A = (A - S[0]) >>> 0;

  const out = Buffer.alloc(8);
  out.writeUInt32LE(A, 0);
  out.writeUInt32LE(B, 4);
  return out;
}

// ---- 64-bit key expansion + block crypt (BigInt) ------------------------

function expandKey64(keyBytes, rounds) {
  const u = 8;
  let key = keyBytes;
  if (key.length === 0) key = Buffer.from([0]);

  const b = key.length;
  const c = Math.max(1, Math.ceil(b / u));
  const L = new Array(c).fill(0n);

  for (let i = b - 1; i >= 0; i--) {
    const wordIdx = (i / u) | 0;
    L[wordIdx] = ((L[wordIdx] << 8n) + BigInt(key[i])) & MASK64;
  }

  const t = 2 * (rounds + 1);
  const S = new Array(t);
  S[0] = P64;
  for (let i = 1; i < t; i++) S[i] = (S[i - 1] + Q64) & MASK64;

  let A = 0n, B = 0n, i = 0, j = 0;
  const n = 3 * Math.max(t, c);
  for (let k = 0; k < n; k++) {
    A = S[i] = rotl64((S[i] + A + B) & MASK64, 3);
    // Python passes (A+B) modulo word width to rotl; rotl64 already
    // masks to 6 bits, so the math is equivalent.
    const rotAmount = Number((A + B) & N63);
    B = L[j] = rotl64((L[j] + A + B) & MASK64, rotAmount);
    i = (i + 1) % t;
    j = (j + 1) % c;
  }
  return S;
}

function encryptBlock64(input, S, rounds) {
  let A = input.readBigUInt64LE(0);
  let B = input.readBigUInt64LE(8);

  A = (A + S[0]) & MASK64;
  B = (B + S[1]) & MASK64;

  for (let i = 1; i <= rounds; i++) {
    const aXorB = (A ^ B) & MASK64;
    A = (rotl64(aXorB, Number(B & N63)) + S[2 * i]) & MASK64;
    const bXorA = (B ^ A) & MASK64;
    B = (rotl64(bXorA, Number(A & N63)) + S[2 * i + 1]) & MASK64;
  }

  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(A, 0);
  out.writeBigUInt64LE(B, 8);
  return out;
}

function decryptBlock64(input, S, rounds) {
  let A = input.readBigUInt64LE(0);
  let B = input.readBigUInt64LE(8);

  for (let i = rounds; i > 0; i--) {
    const bMinus = (B - S[2 * i + 1]) & MASK64;
    B = (rotr64(bMinus, Number(A & N63)) ^ A) & MASK64;
    const aMinus = (A - S[2 * i]) & MASK64;
    A = (rotr64(aMinus, Number(B & N63)) ^ B) & MASK64;
  }

  B = (B - S[1]) & MASK64;
  A = (A - S[0]) & MASK64;

  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(A, 0);
  out.writeBigUInt64LE(B, 8);
  return out;
}

// ---- SDK-specific helpers -----------------------------------------------

// Static key used by libiotp2pav.so for ID encryption (ctx[0x26]).
// The string itself is documented as a Gwell SDK marker, not a secret —
// it's discoverable in the binary via `strings`.
const GWELL_KEY = Buffer.from("www.gwell.cc", "ascii");

/**
 * Derive the 8-byte per-frame RC5 key from a GUTES frame header.
 *
 * From iv_gute_frm_rc5_encrypt (libiotp2pav.c:17750):
 *   key[0..3] = frame[0..3]      (protocol + type + length)
 *   key[4..6] = frame[0x14..0x16] (first 3 bytes of opt_flags)
 *   key[7]   = 0
 *
 * Cryze's comment notes the 8th byte is intentionally zero — the SDK
 * only consumes 7 key bytes despite the cipher taking an 8-byte key.
 */
function derivePerFrameKey(frameHeader) {
  if (frameHeader.length < 0x17) {
    throw new Error(`derivePerFrameKey: header too short (${frameHeader.length} < 23)`);
  }
  const key = Buffer.alloc(8);
  key[0] = frameHeader[0];
  key[1] = frameHeader[1];
  key[2] = frameHeader[2];
  key[3] = frameHeader[3];
  key[4] = frameHeader[0x14];
  key[5] = frameHeader[0x15];
  key[6] = frameHeader[0x16];
  // key[7] left as 0
  return key;
}

/**
 * Encrypt the ID field in a GUTES frame header.
 *
 * From iv_gute_frm_encrypt_id:
 *   1. XOR bytes [4..7] of the ID with [0xC..0xF] of the header (sqnum)
 *   2. XOR bytes [8..11] of the ID with [0x10..0x13] (chkval)
 *   3. RC5-encrypt the resulting 8-byte buffer with the Gwell static key
 *
 * The XOR-then-encrypt pattern keeps each frame's ID ciphertext unique
 * per sqnum/chkval pair even though the key is static.
 */
function idEncrypt(termIdBytes, chkvalBytes, sqnumBytes) {
  if (termIdBytes.length < 8) throw new Error("termIdBytes < 8");
  const idBuf = Buffer.from(termIdBytes.subarray(0, 8));
  for (let i = 0; i < 4; i++) {
    idBuf[i] ^= sqnumBytes[i];
    idBuf[4 + i] ^= chkvalBytes[i];
  }
  const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(GWELL_KEY);
  return rc5.encryptBlock(idBuf);
}

function idDecrypt(encryptedId, chkvalBytes, sqnumBytes) {
  const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(GWELL_KEY);
  const idBuf = Buffer.from(rc5.decryptBlock(encryptedId));
  for (let i = 0; i < 4; i++) {
    idBuf[i] ^= sqnumBytes[i];
    idBuf[4 + i] ^= chkvalBytes[i];
  }
  return idBuf;
}

module.exports = {
  RC5,
  GWELL_KEY,
  derivePerFrameKey,
  idEncrypt,
  idDecrypt,
  // Internal helpers exposed for unit testing only.
  _internal: { rotl32, rotr32, rotl64, rotr64 },
};

// ---- Self-test runs when invoked directly (node lib/rc5.js) -------------

if (require.main === module) {
  let ok = true;
  function check(label, cond) {
    console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
    if (!cond) ok = false;
  }

  // 8-byte block, all-zero key + plaintext round-trip
  {
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(Buffer.alloc(8));
    const pt = Buffer.alloc(8);
    const ct = rc5.encryptBlock(pt);
    const back = rc5.decryptBlock(ct);
    check(`8B zeros encrypt → ${ct.toString("hex")}`, ct.length === 8);
    check(`8B decrypt round-trip`, back.equals(pt));
  }

  // 16-byte block round-trip
  {
    const rc5 = new RC5({ blockBytes: 16, rounds: 6 }).setKey(Buffer.alloc(16, 0x01));
    const pt = Buffer.alloc(16);
    const ct = rc5.encryptBlock(pt);
    const back = rc5.decryptBlock(ct);
    check(`16B encrypt → ${ct.toString("hex")}`, ct.length === 16);
    check(`16B decrypt round-trip`, back.equals(pt));
  }

  // Gwell static key round-trip
  {
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(GWELL_KEY);
    const pt = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const ct = rc5.encryptBlock(pt);
    const back = rc5.decryptBlock(ct);
    check(`Gwell key encrypt → ${ct.toString("hex")}`, ct.length === 8);
    check(`Gwell key round-trip`, back.equals(pt));
  }

  // Per-frame key derivation pattern
  {
    const fakeHeader = Buffer.alloc(0x1C);
    for (let i = 0; i < 0x1C; i++) fakeHeader[i] = i;
    const pfk = derivePerFrameKey(fakeHeader);
    const expected = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x14, 0x15, 0x16, 0x00]);
    check(`per-frame key bytes`, pfk.equals(expected));
  }

  // ECB multi-block round-trip
  {
    const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(GWELL_KEY);
    const pt = Buffer.from("12345678ABCDEFGH");
    const ct = rc5.encrypt(pt);
    const back = rc5.decrypt(ct);
    check(`ECB multi-block round-trip`, back.equals(pt));
  }

  console.log(ok ? "\nAll RC5 self-tests passed." : "\nFAILURES present.");
  process.exit(ok ? 0 : 1);
}
