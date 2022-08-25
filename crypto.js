'use strict'
const md5 = require('md5')

const WyzeConstants = require('./constants')
const wyzeConstants = new WyzeConstants('./constants')

class WyzeCrypto {

    ford_create_signature(url_path, request_method, data) {
        var string_buf = request_method + url_path;
        var keys = Object.keys(data).sort()

        for (var i=0; i<keys.length; i++) { // now lets iterate in sort order
            var key = keys[i];
            var value = data[key];
            string_buf += key + '=' + value + '&';
        } 
        const editedText = string_buf.slice(0, -1).concat(wyzeConstants.FORD_APP_SECRET)
        var urlencoded = encodeURIComponent(editedText)
        return md5(urlencoded);
    }
}


module.exports = WyzeCrypto


