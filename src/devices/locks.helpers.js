const { DeviceModels } = require("../types");

/**
 * Device-object helpers for locks — accept a `device` object instead of
 * raw (mac, model) params. All calls delegate to the core methods in locks.js.
 *
 * MAC-level helpers (getLockDeviceList, getLockGatewayList, lockBoltV2Lock,
 * etc.) are also collected here since they are all thin wrappers around
 * getDeviceList filters or iot3 calls.
 */
module.exports = {
  // ---- MAC-level helpers ---------------------------------------------------

  async getLockDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.LOCK.includes(d.product_model));
  },

  async getLockGatewayList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => DeviceModels.LOCK_GATEWAY.includes(d.product_model));
  },

  async lockBoltV2GetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "lock::door-status",
      "iot-device::iot-state",
      "battery::battery-level",
      "battery::power-source",
      "device-info::firmware-ver",
    ]);
  },

  async lockBoltV2Lock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::lock");
  },

  async lockBoltV2Unlock(deviceMac, deviceModel) {
    return this.iot3RunAction(deviceMac, deviceModel, "lock::unlock");
  },

  async palmLockGetProperties(deviceMac, deviceModel) {
    return this.iot3GetProperties(deviceMac, deviceModel, [
      "lock::lock-status",
      "battery::battery-level",
      "iot-device::iot-state",
      "device-info::firmware-ver",
    ]);
  },

  // ---- Device-object wrappers ----------------------------------------------

  // ---- V1 Lock ---------------------------------------------------------------

  async unlockLock(device) {
    return this.controlLock(device.mac, device.product_model, "remoteUnlock");
  },

  async lockLock(device) {
    return this.controlLock(device.mac, device.product_model, "remoteLock");
  },

  async lockInfo(device) {
    return this.getLockInfo(device.mac, device.product_model);
  },

  async lockKeypad(device) {
    return this.getLockKeypadInfo(device.mac, device.product_model);
  },

  async lockGateway(device) {
    return this.getLockGatewayInfo(device.mac, device.product_model);
  },

  async lockRecords(device, options = {}) {
    return this.getLockRecords(device.mac, device.product_model, options);
  },

  async lockKeys(device) {
    return this.getLockKeys(device.mac, device.product_model);
  },

  async lockFullInfo(device) {
    return this.getLockFullInfo(device.mac);
  },

  // ---- Bolt V2 ---------------------------------------------------------------

  async lockBoltV2Properties(device) {
    return this.lockBoltV2GetProperties(device.mac, device.product_model);
  },

  async lockBoltV2LockDevice(device) {
    return this.lockBoltV2Lock(device.mac, device.product_model);
  },

  async lockBoltV2UnlockDevice(device) {
    return this.lockBoltV2Unlock(device.mac, device.product_model);
  },
};
