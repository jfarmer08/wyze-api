const { propertyIds: PIDs } = require("../types");

/**
 * Device-object helpers for plugs — accept a `device` object with .mac and
 * .product_model instead of raw (mac, model) params.
 *
 * MAC-level helpers (plugPower, plugTurnOn, etc.) are also collected here
 * since they are all thin wrappers around setProperty / setDeviceTimer /
 * cancelDeviceTimer / getDeviceTimer.
 */

module.exports = {
  // ---- MAC-level helpers ---------------------------------------------------

  /**
   * @param {number|string} value — 1=on, 0=off
   */
  async plugPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, value);
  },

  async plugTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "1");
  },

  async plugTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "0");
  },

  async plugTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async plugTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearPlugTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  async getPlugTimer(deviceMac) {
    return this.getDeviceTimer(deviceMac);
  },

  // ---- Device-object wrappers ----------------------------------------------

  async plugOn(device) {
    return this.plugTurnOn(device.mac, device.product_model);
  },

  async plugOff(device) {
    return this.plugTurnOff(device.mac, device.product_model);
  },

  async plugSetPower(device, value) {
    return this.plugPower(device.mac, device.product_model, value);
  },

  async plugOnAfter(device, delaySeconds) {
    return this.plugTurnOnAfter(device.mac, delaySeconds);
  },

  async plugOffAfter(device, delaySeconds) {
    return this.plugTurnOffAfter(device.mac, delaySeconds);
  },

  async plugClearTimer(device) {
    return this.clearPlugTimer(device.mac);
  },

  async plugGetTimer(device) {
    return this.getPlugTimer(device.mac);
  },

  async plugUsageRecords(device, options = {}) {
    return this.getPlugUsageRecords(device.mac, options);
  },
};
