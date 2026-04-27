const axios = require("axios");
const nodeCrypto = require("crypto");
const crypto = require("../crypto");
const constants = require("../constants");

/**
 * IoT3 service (app.wyzecam.com/app/v4/iot3) — used by Lock Bolt V2
 * (DX_LB2) and Palm lock (DX_PVLOC). Custom signature scheme via
 * crypto.iot3CreateSignature; headers include a random requestid.
 */
module.exports = {
  _iot3ExtractModel(deviceMac, deviceModel) {
    if (deviceModel) return deviceModel;
    const parts = deviceMac.split("_");
    return parts.length >= 3 ? parts.slice(0, 2).join("_") : deviceMac;
  },

  _iot3BuildHeaders(bodyStr) {
    return {
      access_token: this.access_token,
      appid: this.oliveAppId,
      appinfo: constants.iot3AppInfo,
      appversion: constants.iot3AppVersion,
      env: "Prod",
      phoneid: this.phoneId,
      requestid: nodeCrypto.randomBytes(16).toString("hex"),
      Signature2: crypto.iot3CreateSignature(bodyStr, this.access_token),
      "Content-Type": "application/json; charset=utf-8",
    };
  },

  async _iot3Post(urlPath, payload) {
    const body = JSON.stringify(payload);
    const headers = this._iot3BuildHeaders(body);
    const url = `${constants.iot3BaseUrl}${urlPath}`;
    if (this.apiLogEnabled) {
      this.log.info(`Performing request: ${url}`);
    }
    try {
      const response = await axios.post(url, body, { headers });
      if (this.apiLogEnabled) {
        this.log.info(`API response IoT3 ${urlPath}: ${JSON.stringify(response.data)}`);
      }
      return response.data;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);
      if (error.response) {
        this.log.error(`Response IoT3 ${urlPath} (${error.response.status} - ${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`);
      }
      throw error;
    }
  },
};
