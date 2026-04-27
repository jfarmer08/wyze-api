const crypto = require('crypto');

const PADDING = Buffer.from("05", "hex");
const BLOCK_SIZE = 16;

function pad(plainText) {
    let raw = Buffer.from(plainText, 'ascii');
    const padNum = BLOCK_SIZE - (raw.length % BLOCK_SIZE);
    raw = Buffer.concat([raw, Buffer.alloc(padNum, PADDING)]);
    return raw;
}

function wyzeEncrypt(key, text) {
    const raw = pad(text);
    const keyBuffer = Buffer.from(key, 'ascii');
    const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, keyBuffer);
    let enc = Buffer.concat([cipher.update(raw), cipher.final()]);
    return enc.toString('base64').replace(/\//g, '\\/');
}

function wyzeDecrypt(key, enc) {
    const keyBuffer = Buffer.from(key, 'ascii');
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, keyBuffer);
    let decrypt = Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]);
    return decrypt.toString('ascii').replace(/\x05/g, '');
}

function createPassword(password) {
    const hex1 = crypto.createHash('md5').update(password).digest('hex');
    const hex2 = crypto.createHash('md5').update(hex1).digest('hex');
    return crypto.createHash('md5').update(hex2).digest('hex');
}

module.exports = {
    wyzeEncrypt,
    wyzeDecrypt,
    createPassword,
};
