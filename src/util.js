const crypto = require('crypto');

// Constants
const PADDING = Buffer.from("05", "hex");
const BLOCK_SIZE = 16;

// Function to pad the plaintext to be multiples of 8-byte blocks
function pad(plainText) {
    console.log('Padding plaintext...');

    let raw = Buffer.from(plainText, 'ascii');
    const padNum = BLOCK_SIZE - (raw.length % BLOCK_SIZE);
    const padBuffer = Buffer.alloc(padNum, PADDING);

    raw = Buffer.concat([raw, padBuffer]);

    console.log(`Padded plaintext: ${raw.toString('hex')}`);
    return raw;
}

function wyzeEncrypt(key, text) {
    console.log('Encrypting text...');

    const raw = pad(text);
    const keyBuffer = Buffer.from(key, 'ascii');
    const iv = keyBuffer;  // Wyze uses the secret key for the IV as well
    const cipher = crypto.createCipheriv('aes-128-cbc', keyBuffer, iv);
    let enc = cipher.update(raw);
    enc = Buffer.concat([enc, cipher.final()]);

    let b64Enc = enc.toString('base64');
    b64Enc = b64Enc.replace(/\//g, '\\/');

    console.log(`Encrypted text: ${b64Enc}`);
    return b64Enc;
}

function wyzeDecrypt(key, enc) {
    console.log('Decrypting text...');

    const encBuffer = Buffer.from(enc, 'base64');
    const keyBuffer = Buffer.from(key, 'ascii');
    const iv = keyBuffer;

    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, iv);
    let decrypt = decipher.update(encBuffer);
    decrypt = Buffer.concat([decrypt, decipher.final()]);

    const decryptTxt = decrypt.toString('ascii').replace(/\x05/g, '');

    console.log(`Decrypted text: ${decryptTxt}`);
    return decryptTxt;
}

function createPassword(password) {
    console.log('Creating password hash...');

    const hex1 = crypto.createHash('md5').update(password).digest('hex');
    const hex2 = crypto.createHash('md5').update(hex1).digest('hex');
    const finalHash = crypto.createHash('md5').update(hex2).digest('hex');

    console.log(`Created password hash: ${finalHash}`);
    return finalHash;
}

module.exports = {
    wyzeEncrypt,
    wyzeDecrypt,
    createPassword,
};
