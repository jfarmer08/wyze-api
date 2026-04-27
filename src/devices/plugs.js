const types = require("../types");

const PIDs = types.propertyIds;

/**
 * Wyze Plug + Plug Outdoor. Power via P3; timers via shared
 * setDeviceTimer/cancelDeviceTimer (mixed in from auth module
 * eventually — currently lives on the class).
 */
module.exports = {
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

  /**
   * Energy usage records between two times.
   * @param {Object} options
   * @param {Date|number} options.startTime
   * @param {Date|number} [options.endTime] — defaults to now
   */
  async getPlugUsageRecords(deviceMac, options = {}) {
    const { startTime, endTime = Date.now() } = options;
    if (startTime == null) {
      throw new Error("getPlugUsageRecords: `startTime` is required");
    }
    const data = {
      device_mac: deviceMac,
      date_begin: startTime instanceof Date ? startTime.getTime() : startTime,
      date_end: endTime instanceof Date ? endTime.getTime() : endTime,
    };
    const result = await this.request("app/v2/plug/usage_record_list", data);
    return result.data;
  },
};
