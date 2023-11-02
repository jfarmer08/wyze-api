const crypto = require("crypto-js");
const base64 = require("base64-js");

const PADDING = crypto.enc.Hex.parse("05");

function pad(plainText) {
  const raw = btoa(plainText);
  const padNum = crypto.blockSize - (raw.sigBytes % crypto.blockSize);
  const padded = raw.concat(PADDING * padNum);
  return padded;
}

function encrypt(key, text) {
  const raw = pad(text);
  const keyBytes = crypto.enc.Utf8.parse(key);
  const iv = keyBytes;
  const cipher = crypto.AES.encrypt(raw, keyBytes, { iv: iv });
  const encrypted = cipher.ciphertext;
  const base64Enc = base64.fromByteArray(encrypted.words);
  const escapedEnc = base64Enc.replace(/\//g, "\\/");
  return escapedEnc;
}

function decrypt(key, enc) {
  const keyBytes = crypto.enc.Utf8.parse(key);
  const iv = keyBytes;
  const encrypted = base64.toByteArray(enc);
  const cipherParams = { ciphertext: crypto.lib.WordArray.create(encrypted) };
  const decrypted = crypto.AES.decrypt(cipherParams, keyBytes, { iv: iv });
  const decryptedText = decrypted.toString(crypto.enc.Utf8);
  return decryptedText;
}

function createPassword(password) {
  const hex1 = crypto.MD5(password).toString();
  const hex2 = crypto.MD5(hex1).toString();
  const hashedPassword = crypto.MD5(hex2).toString();
  return hashedPassword;
}

module.exports = {
  encrypt,
  decrypt,
  createPassword,
};
