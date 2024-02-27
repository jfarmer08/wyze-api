const crypto = require("crypto");
const cryptojs = require("crypto-js");

const PADDING = Buffer.from("05", "hex");

function pad(plainText) {
    let raw = Buffer.from(plainText, 'ascii');
    let padNum = 16 - (raw.length % 16);
    raw = Buffer.concat([raw, Buffer.alloc(padNum, PADDING)]);
    return raw;
}

function encrypt(key, text) {
    let raw = pad(text);
    let iv = Buffer.from(key, 'ascii'); // Wyze uses the secret key for the iv as well
    let cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    console.log(cipher)
    let enc = cipher.update(raw, 'utf-8', 'base64') //+ cipher.final('base64');
    console.log(enc)
    let b64Enc = enc.replace("/", '\/');
    console.log(b64Enc)
    return b64Enc;
}

function decrypt(key, enc) {
    const keyUtf8 = CryptoJS.enc.Utf8.parse(key);
    const iv = keyUtf8;
    const encrypted = CryptoJS.enc.Base64.parse(enc).toString(CryptoJS.enc.Utf8);
    const decrypted = CryptoJS.AES.decrypt(encrypted, keyUtf8, { iv: iv }).toString(CryptoJS.enc.Utf8);
    return decrypted;
}



function createPassword(password) {
  const hex1 = cryptojs.MD5(password).toString();
  const hex2 = cryptojs.MD5(hex1).toString();
  const hashedPassword = cryptojs.MD5(hex2).toString();
  return hashedPassword;
}

module.exports = {
  encrypt,
  decrypt,
  createPassword,
};
