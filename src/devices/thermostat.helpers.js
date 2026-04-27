/**
 * Device-object helpers for the thermostat — accept a `device` object with
 * .mac and .product_model instead of raw (mac, model) params.
 */
module.exports = {
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
