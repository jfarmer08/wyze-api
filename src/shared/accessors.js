/**
 * Cross-cutting pure accessors. Operate on any device or info object
 * (whatever shape the API returned). All return null when the field
 * isn't present, never throw. `this`-dependence: only
 * `deviceIsLowBattery` reads `this.lowBatteryPercentage`.
 */
module.exports = {
  /**
   * Best-effort battery reading. Tries the keys different families use,
   * returns the first defined one.
   */
  deviceGetBattery(device) {
    const dp = device?.device_params ?? {};
    return (
      device?.battary ?? dp.battary ?? // vacuum typo, server-side
      dp.power ??                       // some cameras
      dp.electricity ??                 // mesh/plug power monitoring
      dp.battery ??                     // generic
      dp.voltage ??                     // sensors / locks
      null
    );
  },

  /**
   * Online state — checks family-specific fields in priority order.
   */
  deviceIsOnline(device) {
    if (device?.conn_state !== undefined) return device.conn_state === 1;
    if (device?.device_params?.status !== undefined) return device.device_params.status === 1;
    if (device?.is_online !== undefined) return Boolean(device.is_online);
    if (device?.device_params?.iot_state !== undefined) return device.device_params.iot_state === 1;
    return null;
  },

  deviceGetSignalStrength(device) {
    const dp = device?.device_params ?? {};
    return dp.signal_strength ?? dp.rssi ?? device?.rssi ?? null;
  },

  deviceGetIp(device) {
    const dp = device?.device_params ?? {};
    return dp.ip ?? dp.ipaddr ?? device?.ip ?? device?.ipaddr ?? null;
  },

  deviceGetFirmware(device) {
    return device?.firmware_ver ?? device?.device_params?.firmware_ver ?? null;
  },

  deviceGetMcuFirmware(device) {
    return device?.device_params?.mcu_sys_version ?? device?.mcu_sys_version ?? null;
  },

  deviceGetTimezone(device) {
    return device?.timezone_name ?? device?.device_params?.timezone_name ?? null;
  },

  deviceGetLastSeen(device) {
    const ts = device?.device_params?.last_login_time ?? device?.last_login_time;
    return typeof ts === "number" ? new Date(ts) : null;
  },

  /**
   * Apply the configured low-battery threshold.
   */
  deviceIsLowBattery(device) {
    const v = this.deviceGetBattery(device);
    if (typeof v !== "number") return false;
    return v <= this.lowBatteryPercentage;
  },

  // Sensor-specific accessors (operate on info from getContactSensorInfo /
  // getMotionSensorInfo).

  contactSensorIsOpen(info) {
    const v = info?.device_params?.open_close_state;
    if (typeof v === "number") return v === 1;
    return null;
  },

  motionSensorIsMotion(info) {
    const v = info?.device_params?.motion_state;
    if (typeof v === "number") return v === 1;
    return null;
  },

  sensorBatteryVoltage(info) {
    return info?.device_params?.voltage ?? null;
  },

  sensorRssi(info) {
    return info?.device_params?.rssi ?? null;
  },
};
