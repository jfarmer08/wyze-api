/**
 * Device-object helpers for locks — accept a `device` object instead of
 * raw (mac, model) params. All calls delegate to the core methods in locks.js.
 */
module.exports = {
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
