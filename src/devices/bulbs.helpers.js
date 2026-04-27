const { propertyIds: PIDs } = require("../types");

/**
 * Device-object helpers for bulbs and mesh lights — accept a `device` object
 * with .mac and .product_model instead of raw (mac, model) params.
 */
module.exports = {
  /**
   * Try a local LAN command first, fall back to cloud on failure.
   * Device must include `enr` and `device_params.ip` (from getDeviceList).
   */
  async bulbLocalOrCloud(device, propertyId, propertyValue, actionKey) {
    const enr = device?.enr;
    const ip = device?.device_params?.ip;
    if (enr && ip) {
      try {
        return await this.localBulbCommand(
          device.mac,
          device.product_model,
          enr,
          ip,
          propertyId,
          propertyValue
        );
      } catch (err) {
        if (this.apiLogEnabled) {
          this.log.info(`Local bulb command failed, falling back to cloud: ${err.message}`);
        }
      }
    }
    return this.runActionList(
      device.mac,
      device.product_model,
      propertyId,
      propertyValue,
      actionKey
    );
  },

  async bulbInfo(device) {
    return this.getBulbInfo(device.mac);
  },

  async bulbMusicModeOn(device) {
    return this.setBulbMusicMode(device.mac, device.product_model, true);
  },

  async bulbMusicModeOff(device) {
    return this.setBulbMusicMode(device.mac, device.product_model, false);
  },

  async bulbSunMatch(device, enabled) {
    return this.setBulbSunMatch(device.mac, device.product_model, enabled);
  },

  async bulbSunMatchOn(device) {
    return this.setBulbSunMatch(device.mac, device.product_model, true);
  },

  async bulbSunMatchOff(device) {
    return this.setBulbSunMatch(device.mac, device.product_model, false);
  },

  async bulbPowerLossRecovery(device, mode) {
    return this.setBulbPowerLossRecovery(device.mac, device.product_model, mode);
  },

  async bulbColor(device, hex) {
    return this.setBulbColor(device.mac, device.product_model, hex);
  },

  async bulbColorTemperature(device, value) {
    return this.setBulbColorTemperature(device.mac, device.product_model, value);
  },

  async bulbAwayModeOff(device) {
    return this.setBulbAwayModeOff(device.mac, device.product_model);
  },

  async bulbEffect(device, effectOptions) {
    return this.setBulbEffect(device.mac, device.product_model, effectOptions);
  },

  // Older aliases of lightMeshOn/Off — kept for back-compat.
  async turnMeshOn(deviceMac, deviceModel) {
    return this.runActionList(deviceMac, deviceModel, PIDs.ON, "1", "set_mesh_property");
  },

  async turnMeshOff(deviceMac, deviceModel) {
    return this.runActionList(deviceMac, deviceModel, PIDs.ON, "0", "set_mesh_property");
  },
};
