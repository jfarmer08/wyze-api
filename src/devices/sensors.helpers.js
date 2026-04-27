const { DeviceModels } = require("../types");

/**
 * Device-object helpers for Wyze Sense sensors — accept a `device` object
 * instead of a raw mac string.
 *
 * MAC-level helpers (getContactSensorList, getMotionSensor, etc.) are also
 * collected here since they are all thin list-filter or lookup wrappers.
 */

module.exports = {
  // ---- MAC-level helpers ---------------------------------------------------

  async getContactSensorList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.CONTACT_SENSOR.includes(d.product_model));
  },

  async getContactSensor(mac) {
    const sensors = await this.getContactSensorList();
    return sensors.find((d) => d.mac === mac);
  },

  /**
   * Combined: list entry + device-info merge.
   */
  async getContactSensorInfo(mac) {
    const sensor = await this.getContactSensor(mac);
    if (!sensor) return null;
    const result = { ...sensor };
    try {
      const info = await this.getDeviceInfo(sensor.mac, sensor.product_model);
      if (info?.data) Object.assign(result, info.data);
    } catch (err) {
      this.log.warning(`getContactSensorInfo: device_info failed: ${err.message}`);
    }
    return result;
  },

  async getMotionSensorList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.MOTION_SENSOR.includes(d.product_model));
  },

  async getMotionSensor(mac) {
    const sensors = await this.getMotionSensorList();
    return sensors.find((d) => d.mac === mac);
  },

  async getMotionSensorInfo(mac) {
    const sensor = await this.getMotionSensor(mac);
    if (!sensor) return null;
    const result = { ...sensor };
    try {
      const info = await this.getDeviceInfo(sensor.mac, sensor.product_model);
      if (info?.data) Object.assign(result, info.data);
    } catch (err) {
      this.log.warning(`getMotionSensorInfo: device_info failed: ${err.message}`);
    }
    return result;
  },

  // ---- Device-object wrappers ----------------------------------------------

  async contactSensorInfo(device) {
    return this.getContactSensorInfo(device.mac);
  },

  async motionSensorInfo(device) {
    return this.getMotionSensorInfo(device.mac);
  },
};
