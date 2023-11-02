const crypto = require('crypto')
const utf8 = require('utf8')
const querystring = require('querystring')
const constants = require('./constants')


function fordCreateSignature(url_path, request_method, data) {
    let body = request_method + url_path;
    let keys = Object.keys(data).sort()
    for (const element of keys) { // now lets iterate in sort order
        let key = element;
        let value = data[key];
        body += key + '=' + value + '&';
    }
    const payload = body.slice(0, -1).concat(constants.fordAppSecret)
    let urlencoded = encodeURIComponent(payload)
    let en = crypto.createHash('md5').update(utf8.encode(urlencoded))
    let dig = en.digest('hex')
    return dig
}

function oliveCreateSignatureSingle(payload, access_token) {
    let access_key = access_token + constants.oliveSigningSecret
    let secret = crypto.createHash('md5').update(utf8.encode(access_key))
    let secrestDig = secret.digest('hex')
    let hmac = crypto.createHmac("md5", utf8.encode(secrestDig)).update(utf8.encode(payload), crypto.md5)
    let digest = hmac.digest('hex')
    return digest
}

function oliveCreateSignature(payload, access_token) {
    let body = '';
    let keys = Object.keys(payload).sort()
    for (var i = 0; i < keys.length; i++) { // now lets iterate in sort order
        var key = keys[i];
        var value = payload[key];
        body += key + '=' + String(value) + '&';
    }

    body = body.slice(0, -1)
    let access_key = access_token + constants.oliveSigningSecret
    let secret = crypto.createHash('md5').update(utf8.encode(access_key))
    let secrestDig = secret.digest('hex')
    let hmac = crypto.createHmac("md5", utf8.encode(secrestDig)).update(utf8.encode(body), crypto.md5)
    let digest = hmac.digest('hex')
    return digest
}


//New Calls 
function olive_create_signature(payload, access_token) {
    let body

    if (typeof payload === "object") {
        body = Object.keys(payload)
            .sort()
            .map(key => `${key}=${payload[key]}`)
            .join("&")
    } else {
        body = payload
    }

    const access_key = `${access_token}${constants.oliveSigningSecret}`
    const secret = crypto.createHash("md5").update(access_key).digest("hex")

    return crypto.createHmac("md5", secret).update(body).digest("hex")
}

function ford_create_signature(url_path, request_method, payload) {
    let string_buf = request_method + url_path

    Object.keys(payload)
        .sort()
        .forEach(key => {
            string_buf += `${key}=${payload[key]}&`
        })

    string_buf = string_buf.slice(0, -1)
    string_buf += constants.fordAppSecret

    const urlencoded = querystring.escape(string_buf)
    return crypto.createHash("md5").update(urlencoded).digest("hex")
}

module.exports = {
    fordCreateSignature,
    oliveCreateSignatureSingle,
    oliveCreateSignature,
    olive_create_signature,
    ford_create_signature
}