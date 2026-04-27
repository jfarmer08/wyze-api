/**
 * Device-object helpers for the Wyze Wall Switch — accept a `device` object
 * with .mac and .product_model instead of raw (mac, model) params.
 *
 * MAC-level helpers (wallSwitchPower, wallSwitchIot, etc.) are also collected
 * here since they are all thin wrappers around setIotProp / setDeviceTimer /
 * cancelDeviceTimer.
 */

// ---- MAC-level helpers -------------------------------------------------------

module.exports = {
  // ---- Power (load) ---------------------------------------------------------

  async wallSwitchPower(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", value);
  },

  async wallSwitchPowerOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", true);
  },

  async wallSwitchPowerOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", false);
  },

  async wallSwitchPowerOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async wallSwitchPowerOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearWallSwitchTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  // ---- IoT smart action ----------------------------------------------------

  async wallSwitchIot(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", value);
  },

  async wallSwitchIotOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", true);
  },

  async wallSwitchIotOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", false);
  },

  // ---- LED indicator -------------------------------------------------------

  async wallSwitchLedStateOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", true);
  },

  async wallSwitchLedStateOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", false);
  },

  // ---- Vacation mode (note inverted semantics: 0=on, 1=off) ----------------

  async wallSwitchVacationModeOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 0);
  },

  async wallSwitchVacationModeOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 1);
  },

  // ---- Press-type customization --------------------------------------------
  // The smart wall switch can route single/double/triple/long-press to
  // different IoT actions independently of the load. Each prop takes an
  // integer action id; `additional_interaction_switch` is the master toggle.

  async setWallSwitchSinglePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "single_press_type", value);
  },

  async setWallSwitchDoublePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "double_press_type", value);
  },

  async setWallSwitchTriplePressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "triple_press_type", value);
  },

  async setWallSwitchLongPressType(deviceMac, deviceModel, value) {
    return this.setIotProp(deviceMac, deviceModel, "long_press_type", value);
  },

  async setWallSwitchPressTypesEnabled(deviceMac, deviceModel, enabled) {
    return this.setIotProp(deviceMac, deviceModel, "additional_interaction_switch", Boolean(enabled));
  },

  // ---- Device-object wrappers ----------------------------------------------

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
