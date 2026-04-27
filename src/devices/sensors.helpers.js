/**
 * Device-object helpers for Wyze Sense sensors — accept a `device` object
 * instead of a raw mac string.
 */
module.exports = {
  async contactSensorInfo(device) {
    return this.getContactSensorInfo(device.mac);
  },

  async motionSensorInfo(device) {
    return this.getMotionSensorInfo(device.mac);
  },
};
