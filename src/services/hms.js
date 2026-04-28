const axios = require("axios");
const crypto = require("../utils/crypto");
const constants = require("../constants");

/**
 * HMS service (hms.api.wyze.com) — handles three distinct shapes:
 *   - DELETE with body, no signing (Authorization header only)
 *   - GET with olive signing + Authorization header
 *   - PATCH with olive signing + body
 */
module.exports = {
  async _hmsRequest(method, url, options = {}) {
    await this.maybeLogin();
    const { params, body, sign = false, contentType = false, label } = options;

    const headers = {
      Authorization: this.access_token,
      "User-Agent": this.userAgent,
    };
    if (sign) {
      const signature = crypto.oliveCreateSignature(params, this.access_token);
      Object.assign(headers, {
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      });
    }
    if (contentType) headers["Content-Type"] = "application/json";

    const config = { headers };
    if (params) config.params = params;
    if (body !== undefined && method.toLowerCase() === "delete") {
      // axios.delete takes body via config.data
      config.data = body;
    }

    this.log.debug(`Performing request: ${url}`);
    try {
      let result;
      const m = method.toLowerCase();
      if (m === "get") result = await axios.get(url, config);
      else if (m === "delete") result = await axios.delete(url, config);
      else if (m === "patch") result = await axios.patch(url, body, config);
      else if (m === "post") result = await axios.post(url, body, config);
      else throw new Error(`_hmsRequest: unsupported method ${method}`);

              this.log.debug(`API response ${label || "HMS"}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response ${label || "HMS"} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },
};
