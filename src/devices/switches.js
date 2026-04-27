const types = require("../types");

/**
 * Wyze Smart Wall Switch (LD_SS1). Distinct surfaces:
 *   - power: drives the load (the wired light)
 *   - iot:   triggers an associated IoT action
 *   - led_state: indicator LED
 *   - vacation_mode: 0=on, 1=off (Wyze inverts this one)
 *   - single/double/triple/long press_type: customizable press handlers
 *
 * Most prop writes go through `setIotProp` which targets the sirius
 * service.
 */
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
};

// Re-export the wallSwitch enum for convenience.
module.exports.wyzeWallSwitch = types.wyzeWallSwitch;
