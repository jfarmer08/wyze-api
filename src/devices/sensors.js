const { DeviceModels } = require("../types");

/**
 * Wyze Sense sensors — contact (DWS3U/DWS2U) and motion (PIR3U/PIR2U).
 * Read-only family (state changes are reported by the device, not pushed).
 *
 * Pure accessors (`contactSensorIsOpen`, `motionSensorIsMotion`,
 * `sensorBatteryVoltage`, `sensorRssi`) live in `shared/accessors.js`.
 */
module.exports = {
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
};
