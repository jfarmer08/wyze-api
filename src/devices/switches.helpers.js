/**
 * Device-object helpers for the Wyze Wall Switch — accept a `device` object
 * with .mac and .product_model instead of raw (mac, model) params.
 */
module.exports = {
  async switchPowerOn(device) {
    return this.wallSwitchPowerOn(device.mac, device.product_model);
  },

  async switchPowerOff(device) {
    return this.wallSwitchPowerOff(device.mac, device.product_model);
  },

  async switchPower(device, value) {
    return this.wallSwitchPower(device.mac, device.product_model, value);
  },

  async switchPowerOnAfter(device, delaySeconds) {
    return this.wallSwitchPowerOnAfter(device.mac, delaySeconds);
  },

  async switchPowerOffAfter(device, delaySeconds) {
    return this.wallSwitchPowerOffAfter(device.mac, delaySeconds);
  },

  async switchClearTimer(device) {
    return this.clearWallSwitchTimer(device.mac);
  },

  async switchIotOn(device) {
    return this.wallSwitchIotOn(device.mac, device.product_model);
  },

  async switchIotOff(device) {
    return this.wallSwitchIotOff(device.mac, device.product_model);
  },

  async switchIot(device, value) {
    return this.wallSwitchIot(device.mac, device.product_model, value);
  },

  async switchLedOn(device) {
    return this.wallSwitchLedStateOn(device.mac, device.product_model);
  },

  async switchLedOff(device) {
    return this.wallSwitchLedStateOff(device.mac, device.product_model);
  },

  async switchVacationModeOn(device) {
    return this.wallSwitchVacationModeOn(device.mac, device.product_model);
  },

  async switchVacationModeOff(device) {
    return this.wallSwitchVacationModeOff(device.mac, device.product_model);
  },

  async switchSinglePressType(device, value) {
    return this.setWallSwitchSinglePressType(device.mac, device.product_model, value);
  },

  async switchDoublePressType(device, value) {
    return this.setWallSwitchDoublePressType(device.mac, device.product_model, value);
  },

  async switchTriplePressType(device, value) {
    return this.setWallSwitchTriplePressType(device.mac, device.product_model, value);
  },

  async switchLongPressType(device, value) {
    return this.setWallSwitchLongPressType(device.mac, device.product_model, value);
  },

  async switchPressTypesEnabled(device, enabled) {
    return this.setWallSwitchPressTypesEnabled(device.mac, device.product_model, enabled);
  },
};
