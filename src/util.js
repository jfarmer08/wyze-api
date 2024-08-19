const crypto = require('crypto');

const PADDING = Buffer.from('05', 'hex');

// Pads plain text to a multiple of 16 bytes (AES block size)
function pad(plainText) {
    const raw = Buffer.from(plainText, 'ascii');
    const padLength = 16 - (raw.length % 16);
    return Buffer.concat([raw, Buffer.alloc(padLength, PADDING)]);
}

// Encrypts text using AES-128-CBC mode
function wyzeEncrypt(key, text) {
    const raw = pad(text);
    const keyBuffer = Buffer.from(key, 'ascii');
    const iv = keyBuffer; // Wyze uses the secret key as the IV as well
    const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
    return encrypted.toString('base64').replace(/\//g, '\\/');
}

// Decrypts text using AES-128-CBC mode
function wyzeDecrypt(key, enc) {
    const encBuffer = Buffer.from(enc, 'base64');
    const keyBuffer = Buffer.from(key, 'ascii');
    const iv = keyBuffer; // Wyze uses the secret key as the IV as well
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, iv);
    const decrypted = Buffer.concat([decipher.update(encBuffer), decipher.final()]);
    return decrypted.toString('ascii');
}

// Creates a password hash using triple MD5 hashing
function createPassword(password) {
    const hash1 = crypto.createHash('md5').update(password).digest('hex');
    const hash2 = crypto.createHash('md5').update(hash1).digest('hex');
    return crypto.createHash('md5').update(hash2).digest('hex');
}

module.exports = {
    wyzeEncrypt,
    wyzeDecrypt,
    createPassword,
};
