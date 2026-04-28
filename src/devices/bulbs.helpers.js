const { propertyIds: PIDs, DeviceModels } = require("../types");

/**
 * Device-object helpers for bulbs and mesh lights — accept a `device` object
 * with .mac and .product_model instead of raw (mac, model) params.
 */
module.exports = {
  // ---- Basic light power (direct) ------------------------------------------

  async lightPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, value);
  },

  async lightTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "1");
  },

  async lightTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.ON, "0");
  },

  async lightTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async lightTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearLightTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  // Convenience aliases — bulb-named timers (same wire as light timers).
  async bulbTurnOnAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 1);
  },

  async bulbTurnOffAfter(deviceMac, delaySeconds) {
    return this.setDeviceTimer(deviceMac, delaySeconds, 0);
  },

  async clearBulbTimer(deviceMac) {
    return this.cancelDeviceTimer(deviceMac);
  },

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.BRIGHTNESS, value);
  },

  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.COLOR_TEMP, value);
  },

  // ---- Lookup --------------------------------------------------------------

  async getBulbDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.BULB.includes(d.product_model));
  },

  async getBulb(mac) {
    const bulbs = await this.getBulbDeviceList();
    return bulbs.find((d) => d.mac === mac);
  },

  /**
   * Set behavior on power restore. P1509 with `LightPowerLossRecoveryMode`.
   */
  async setBulbPowerLossRecovery(deviceMac, deviceModel, mode) {
    return this.setProperty(deviceMac, deviceModel, PIDs.POWER_LOSS_RECOVERY, String(mode));
  },

  /**
   * Disable bulb away mode. P1506 = "0". The enable path needs an
   * undocumented switch_rule generator and is deliberately not implemented.
   */
  async setBulbAwayModeOff(deviceMac, deviceModel) {
    return this.setProperty(deviceMac, deviceModel, PIDs.AWAY_MODE, "0");
  },

  // ---- Mesh bulb / light strip basic controls ------------------------------

  async lightMeshPower(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, value, "set_mesh_property");
  },

  async lightMeshOn(deviceMac, deviceModel) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, "1", "set_mesh_property");
  },

  async lightMeshOff(deviceMac, deviceModel) {
    await this.runActionList(deviceMac, deviceModel, PIDs.ON, "0", "set_mesh_property");
  },

  async setMeshBrightness(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.BRIGHTNESS, value, "set_mesh_property");
  },

  async setMeshColorTemperature(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR_TEMP, value, "set_mesh_property");
  },

  async setMeshHue(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, value, "set_mesh_property");
  },

  async setMeshSaturation(deviceMac, deviceModel, value) {
    await this.runActionList(deviceMac, deviceModel, PIDs.COLOR, value, "set_mesh_property");
  },

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
                  this.log.debug(`Local bulb command failed, falling back to cloud: ${err.message}`);
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
