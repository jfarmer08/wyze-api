/**
 * Device-object helpers for the Wyze Sprinkler — accept a `device` object
 * with .mac instead of a raw mac string.
 */
module.exports = {
  async irrigationIotProp(device) {
    return this.irrigationGetIotProp(device.mac);
  },

  async irrigationDeviceInfo(device) {
    return this.irrigationGetDeviceInfo(device.mac);
  },

  async irrigationZones(device) {
    return this.irrigationGetZones(device.mac);
  },

  async irrigationRun(device, zoneNumber, duration) {
    return this.irrigationQuickRun(device.mac, zoneNumber, duration);
  },

  async irrigationStopDevice(device) {
    return this.irrigationStop(device.mac);
  },

  async irrigationScheduleRuns(device, limit = 2) {
    return this.irrigationGetScheduleRuns(device.mac, limit);
  },
};
