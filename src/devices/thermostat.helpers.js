/**
 * Device-object helpers for the thermostat — accept a `device` object with
 * .mac and .product_model instead of raw (mac, model) params.
 *
 * MAC-level helpers (setThermostatLock, clearThermostatHold) are also
 * collected here since they are thin single-call wrappers around
 * thermostatSetIotProp.
 */
module.exports = {
  // ---- MAC-level helpers ---------------------------------------------------

  /**
   * Toggle the child-lock (kid_lock).
   */
  async setThermostatLock(deviceMac, deviceModel, locked) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "kid_lock", locked ? "1" : "0");
  },

  /**
   * Clear an active manual hold.
   */
  async clearThermostatHold(deviceMac, deviceModel) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "dev_hold", "0");
  },

  // ---- Device-object wrappers ----------------------------------------------

  async thermostatSystemMode(device, mode) {
    return this.setThermostatSystemMode(device.mac, device.product_model, mode);
  },

  async thermostatFanMode(device, mode) {
    return this.setThermostatFanMode(device.mac, device.product_model, mode);
  },

  async thermostatScenario(device, scenario) {
    return this.setThermostatScenario(device.mac, device.product_model, scenario);
  },

  async thermostatHeatingSetpoint(device, value) {
    return this.setThermostatHeatingSetpoint(device.mac, device.product_model, value);
  },

  async thermostatCoolingSetpoint(device, value) {
    return this.setThermostatCoolingSetpoint(device.mac, device.product_model, value);
  },

  async thermostatTemperature(device, coolingSetpoint, heatingSetpoint) {
    return this.setThermostatTemperature(device.mac, device.product_model, coolingSetpoint, heatingSetpoint);
  },

  async thermostatLock(device, locked) {
    return this.setThermostatLock(device.mac, device.product_model, locked);
  },

  async thermostatComfortBalance(device, mode) {
    return this.setThermostatComfortBalance(device.mac, device.product_model, mode);
  },

  async thermostatHold(device, until) {
    return this.holdThermostat(device.mac, device.product_model, until);
  },

  async thermostatClearHold(device) {
    return this.clearThermostatHold(device.mac, device.product_model);
  },
};
