"use strict";

/**
 * XXTEA (Corrected Block TEA) — a small symmetric block cipher used by
 * Wyze for the challenge-response step in the IOTC auth handshake.
 *
 * Reference: D. Wheeler & R. Needham, "Correction to xtea" (1998).
 * https://www.cix.co.uk/~klockstone/xxtea.pdf
 *
 * The Python `xxtea` package (PyPI) is what docker-wyze-bridge uses.
 * This JS port matches its `decrypt(data, key, padding=False)` and
 * `encrypt(data, key, padding=False)` semantics exactly — no PKCS#7
 * padding, caller is responsible for length alignment.
 *
 * Key facts:
 *   - Block: 32-bit words, treated as a vector of n ≥ 2 words
 *   - Key: 16 bytes (4 words) — shorter keys are zero-padded, longer truncated
 *   - Encrypts the entire buffer as one big block, not 8 bytes at a time
 *   - Rounds = 6 + 52/n  (so 9 rounds for the typical 16-byte input)
 *
 * Data length:
 *   - Must be a multiple of 4 bytes (otherwise the JS port matches
 *     Python's behavior of ValueError-equivalent — we throw)
 *   - Must be at least 8 bytes (n ≥ 2)
 *
 * In the Wyze handshake context:
 *   - Camera sends 16 bytes of challenge (camera_enr_b)
 *   - We xxtea-decrypt them using the camera's enr as the key
 *   - The plaintext is the 16-byte challenge_response we ship back
 *     in K10002/K10006/K10008
 */

const DELTA = 0x9E3779B9;
const MASK32 = 0xFFFFFFFF;

function toWords(buf) {
  if (buf.length % 4 !== 0) {
    throw new Error(`xxtea: data length ${buf.length} not multiple of 4`);
  }
  const n = buf.length / 4;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readUInt32LE(i * 4);
  return out;
}

function fromWords(words) {
  const out = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) out.writeUInt32LE(words[i] >>> 0, i * 4);
  return out;
}

function normalizeKey(key) {
  // Python xxtea allows arbitrary key length; it zero-pads or truncates
  // to 16 bytes before use. We do the same.
  const k = Buffer.alloc(16);
  key.copy(k, 0, 0, Math.min(16, key.length));
  return [
    k.readUInt32LE(0),
    k.readUInt32LE(4),
    k.readUInt32LE(8),
    k.readUInt32LE(12),
  ];
}

// The MX function in the XXTEA paper. e and y/z mix in the standard
// scrambling pattern; we compute the round subkey by indexing k via
// (p & 3) ^ e.
function mx(y, z, sum, p, e, k) {
  const a = ((z >>> 5) ^ ((y << 2) >>> 0)) >>> 0;
  const b = ((y >>> 3) ^ ((z << 4) >>> 0)) >>> 0;
  const c = ((sum ^ y) >>> 0);
  const d = ((k[((p & 3) ^ e) >>> 0] ^ z) >>> 0);
  return ((((a + b) >>> 0) ^ ((c + d) >>> 0)) >>> 0);
}

/**
 * @param {Buffer} data — payload, length must be multiple of 4 and ≥ 8
 * @param {Buffer} key  — up to 16 bytes; zero-padded if shorter
 * @returns {Buffer}
 */
function encrypt(data, key) {
  const v = toWords(data);
  const n = v.length;
  if (n < 2) throw new Error(`xxtea: data must be at least 8 bytes (got ${data.length})`);

  const k = normalizeKey(key);
  const rounds = 6 + Math.floor(52 / n);
  let sum = 0;
  let z = v[n - 1];

  for (let r = 0; r < rounds; r++) {
    sum = (sum + DELTA) >>> 0;
    const e = (sum >>> 2) & 3;
    for (let p = 0; p < n - 1; p++) {
      const y = v[p + 1];
      v[p] = (v[p] + mx(y, z, sum, p, e, k)) >>> 0;
      z = v[p];
    }
    const y = v[0];
    v[n - 1] = (v[n - 1] + mx(y, z, sum, n - 1, e, k)) >>> 0;
    z = v[n - 1];
  }
  return fromWords(v);
}

/**
 * @param {Buffer} data
 * @param {Buffer} key
 * @returns {Buffer}
 */
function decrypt(data, key) {
  const v = toWords(data);
  const n = v.length;
  if (n < 2) throw new Error(`xxtea: data must be at least 8 bytes (got ${data.length})`);

  const k = normalizeKey(key);
  const rounds = 6 + Math.floor(52 / n);
  let sum = (rounds * DELTA) >>> 0;
  let y = v[0];

  for (let r = 0; r < rounds; r++) {
    const e = (sum >>> 2) & 3;
    for (let p = n - 1; p > 0; p--) {
      const z = v[p - 1];
      v[p] = (v[p] - mx(y, z, sum, p, e, k)) >>> 0;
      y = v[p];
    }
    const z = v[n - 1];
    v[0] = (v[0] - mx(y, z, sum, 0, e, k)) >>> 0;
    y = v[0];
    sum = (sum - DELTA) >>> 0;
  }
  return fromWords(v);
}

module.exports = { encrypt, decrypt };

// ---- Self-test ----------------------------------------------------------

if (require.main === module) {
  let ok = true;
  function check(label, cond) {
    console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
    if (!cond) ok = false;
  }

  // Round-trip
  {
    const key = Buffer.from("0123456789ABCDEF", "ascii");
    const pt = Buffer.from("Hello, XXTEA world!!", "ascii");
    // Pad to multiple of 4 (Python xxtea with padding=False requires this)
    const padded = Buffer.alloc(20);
    pt.copy(padded);
    const ct = encrypt(padded, key);
    const back = decrypt(ct, key);
    check("16B key round-trip preserves plaintext", back.equals(padded));
  }

  // Cross-language vectors — verified against pyxxtea v3.x (the package
  // docker-wyze-bridge uses). To regenerate:
  //   python3 -c "import xxtea; print(xxtea.encrypt(<pt>, <key>, padding=False).hex())"
  {
    const key = Buffer.from("FFFFFFFFFFFFFFFF", "ascii");
    const pt8 = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const ct8 = encrypt(pt8, key);
    check(`pyxxtea match: 8B input`,
      ct8.toString("hex") === "922fb3ed69e24564");

    const pt32 = Buffer.from("0123456789abcdef0123456789abcdef", "ascii");
    const ct32 = encrypt(pt32, key);
    check(`pyxxtea match: 32B input`,
      ct32.toString("hex") === "6f649d40c37b698e5548c1a47203342903ffa8e2db4f1ed20d656680c36122e0");
    check(`32B decrypt round-trip`, decrypt(ct32, key).equals(pt32));
  }

  console.log(ok ? "\nAll xxtea self-tests passed." : "\nFAILURES present.");
  process.exit(ok ? 0 : 1);
}
