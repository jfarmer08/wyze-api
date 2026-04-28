const axios = require("axios");
const payloadFactory = require("../utils/payloadFactory");
const constants = require("../constants");

/**
 * Ford service (yd-saas-toc.wyzecam.com) — V1 locks. Signing happens via
 * payloadFactory.fordCreatePayload, which adds accessToken / key /
 * timestamp / sign onto the params.
 */
module.exports = {
  async _fordGet(urlPath, params = {}) {
    await this.maybeLogin();
    // fordCreatePayload picks the right token field name (access_token for
    // GET, accessToken for POST) and lowercases the method for signing.
    const signedParams = payloadFactory.fordCreatePayload(
      this.access_token,
      params,
      urlPath,
      "get"
    );
    const url = `${constants.fordBaseUrl}${urlPath}`;
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.get(url, { params: signedParams });
              this.log.debug(`API response Ford GET ${urlPath}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response Ford GET ${urlPath} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  async _fordPost(urlPath, params = {}, method = "post") {
    await this.maybeLogin();
    // The signing string uses lowercase method (handled inside
    // fordCreatePayload). axios accepts either case, so we keep the
    // original method for the actual request.
    const signedPayload = payloadFactory.fordCreatePayload(
      this.access_token,
      params,
      urlPath,
      method
    );
    const url = `${constants.fordBaseUrl}${urlPath}`;
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.request({ url, method, data: signedPayload });
              this.log.debug(`API response Ford ${method.toUpperCase()} ${urlPath}: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response Ford ${method.toUpperCase()} ${urlPath} (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },
};
