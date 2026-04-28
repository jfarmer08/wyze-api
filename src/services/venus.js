const axios = require("axios");
const crypto = require("../utils/crypto");
const constants = require("../constants");

/**
 * Venus service (Wyze Robot Vacuum, JA_RO2). Auth/signing differs from
 * olive: per request,
 *   nonce       = Date.now() (ms)
 *   requestid   = md5(md5(String(nonce)))
 *   signature2  = HMAC-MD5(key=md5(access_token + venusSigningSecret), body)
 * For POST: `nonce` (string) is injected into the JSON body before
 * signing; signed body is the no-whitespace JSON.stringify of the payload.
 * For GET: `nonce` (number) is added to params; signed body is the sorted
 * "k=v&k=v" param string (raw values, no URL encoding).
 */
module.exports = {
  _venusBuildHeaders(nonce, signature) {
    return {
      "Accept-Encoding": "gzip",
      "User-Agent": this.userAgent,
      access_token: this.access_token,
      appid: constants.venusAppId,
      appinfo: this.appInfo,
      phoneid: this.phoneId,
      requestid: crypto.venusRequestId(nonce),
      signature2: signature,
    };
  },

  _venusSortedQuery(params) {
    return Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
  },

  async _venusRequest(method, path, payload = {}) {
    await this.maybeLogin();

    const nonce = Date.now();
    const url = `${constants.venusBaseUrl}${path}`;
    const verb = method.toUpperCase();

    let response;
    try {
      if (verb === "GET") {
        const params = { ...payload, nonce };
        const signature = crypto.venusGenerateDynamicSignature(
          this._venusSortedQuery(params),
          this.access_token
        );
        const headers = this._venusBuildHeaders(nonce, signature);
        this.log.debug(`Performing request: ${url}`);
        response = await axios.get(url, { headers, params });
      } else {
        const body = { ...payload, nonce: String(nonce) };
        const bodyStr = JSON.stringify(body);
        const signature = crypto.venusGenerateDynamicSignature(bodyStr, this.access_token);
        const headers = {
          ...this._venusBuildHeaders(nonce, signature),
          "Content-Type": "application/json; charset=utf-8",
        };
        this.log.debug(`Performing request: ${url}`);
        response = await axios.request({ url, method: verb, headers, data: bodyStr });
      }
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response Venus ${verb} ${path} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }

          this.log.debug(`API response Venus ${verb} ${path}: ${JSON.stringify(response.data)}`);
    return response.data;
  },
};
