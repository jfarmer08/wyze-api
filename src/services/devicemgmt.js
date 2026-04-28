const axios = require("axios");
const nodeCrypto = require("crypto");
const constants = require("../constants");

/**
 * DeviceMgmt API — used by newer cameras (Floodlight Pro / Battery Cam Pro
 * / OG cam) that don't respond to the standard run_action endpoint.
 *
 * - run_action: POST to devicemgmt-service-beta.wyze.com with bare
 *   `authorization: <access_token>` header (no olive signing).
 * - set_toggle: POST to ai-subscription-service-beta.wyzecam.com with
 *   olive signing (uses _oliveSignedPost from services/olive.js).
 */
module.exports = {
  _deviceMgmtBuildCapability(type, value) {
    switch (type) {
      case "floodlight":
        return { iid: 4, name: "floodlight", properties: [{ prop: "on", value }] };
      case "spotlight":
        return { iid: 5, name: "spotlight", properties: [{ prop: "on", value }] };
      case "power":
        return {
          functions: [{ in: { "wakeup-live-view": "1" }, name: value }],
          iid: 1,
          name: "iot-device",
        };
      case "siren":
        return { functions: [{ in: {}, name: value }], name: "siren" };
      default:
        throw new Error(`_deviceMgmtBuildCapability: unsupported type ${type}`);
    }
  },

  async _deviceMgmtRunAction(deviceMac, deviceModel, type, value) {
    await this.maybeLogin();
    const payload = {
      capabilities: [this._deviceMgmtBuildCapability(type, value)],
      nonce: Date.now(),
      targetInfo: {
        id: deviceMac,
        productModel: deviceModel,
        type: "DEVICE",
      },
      // OG cam needs a transactionId — server doesn't validate the value.
      transactionId: nodeCrypto.randomBytes(16).toString("hex"),
    };
    const url = `${constants.devicemgmtBaseUrl}/device-management/api/action/run_action`;
    this.log.debug(`Performing request: ${url}`);
    try {
      const result = await axios.post(url, payload, {
        headers: { authorization: this.access_token },
      });
              this.log.debug(`API response DeviceMgmt run_action: ${JSON.stringify(result.data)}`);
      return result.data;
    } catch (e) {
      this.log.error(`Request failed: ${e.message}`);
      if (e.response) {
        this.log.error(
          `Response DeviceMgmt run_action (${e.response.status} - ${e.response.statusText}): ${JSON.stringify(e.response.data, null, 2)}`
        );
      }
      throw e;
    }
  },

  async _deviceMgmtSetToggle(deviceMac, deviceModel, toggleType, state) {
    const payload = {
      data: [
        {
          device_firmware: "1234567890",
          device_id: deviceMac,
          device_model: deviceModel,
          page_id: [toggleType.pageId],
          toggle_update: [{ toggle_id: toggleType.toggleId, toggle_status: state }],
        },
      ],
      nonce: String(Date.now()),
    };
    return this._oliveSignedPost(
      `${constants.aiSubscriptionBaseUrl}/v4/subscription-service/toggle-management`,
      payload,
      "DeviceMgmtSetToggle"
    );
  },
};
