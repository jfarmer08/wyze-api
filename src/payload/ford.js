// Ford payloads

let constants = require("../constants");
let crypto = require("../crypto");

function fordCreatePayload(access_token, payload, url_path, request_method) {
  payload["accessToken"] = access_token;
  payload["key"] = constants.fordAppKey;
  payload["timestamp"] = Date.now().toString();
  payload["sign"] = crypto.fordCreateSignature(
    url_path,
    request_method,
    payload
  );
  return payload;
}
module.exports = {
  fordCreatePayload
}