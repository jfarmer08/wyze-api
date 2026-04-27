/**
 * Device-object helpers for plugs — accept a `device` object with .mac and
 * .product_model instead of raw (mac, model) params.
 */
module.exports = {
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
