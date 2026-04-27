/**
 * Wyze Plug + Plug Outdoor. Thin wrappers (plugPower, plugTurnOn, timers, etc.)
 * live in plugs.helpers.js. This file retains only methods with real logic.
 */
module.exports = {
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
