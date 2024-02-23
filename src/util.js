const crypto = require("crypto-js");

const PADDING = Buffer.from("05", "hex");

function pad(plainText) {
    const raw = Buffer.from(plainText, "ascii");
    const padNum = 16 - (raw.length % 16);
    const paddedRaw = Buffer.concat([raw, PADDING.repeat(padNum)]);
    return paddedRaw;
}

function encrypt(key, text) {
    const raw = pad(text);
    const keyBuffer = Buffer.from(key, "ascii");
    const iv = keyBuffer;
    const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, iv);
    let enc = cipher.update(raw);
    enc = Buffer.concat([enc, cipher.final()]);
    let b64Enc = enc.toString('base64');
    b64Enc = b64Enc.replace(/\//g, '\\/');
    return b64Enc;
}

function decrypt(key, enc) {
  const encBuffer = Buffer.from(enc, 'base64');
  const keyBuffer = Buffer.from(key, 'ascii');
  const iv = keyBuffer;
  const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, iv);
  let decrypted = decipher.update(encBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('ascii');
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
