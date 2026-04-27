const {
  VacuumSuctionLevel,
  VacuumFaultCode,
  parseVacuumMode,
} = require("../types");

/**
 * Device-object helpers for the robot vacuum.
 * Async methods accept a `device` object; pure accessors accept the merged
 * result of getVacuumInfo().
 */
module.exports = {
  // ---- Device-object wrappers -----------------------------------------------

  async vacuumStartCleaning(device) {
    return this.vacuumClean(device.mac);
  },

  async vacuumPauseCleaning(device) {
    return this.vacuumPause(device.mac);
  },

  async vacuumReturnToDock(device) {
    return this.vacuumDock(device.mac);
  },

  async vacuumCleanRooms(device, roomIds) {
    return this.vacuumSweepRooms(device.mac, roomIds);
  },

  async vacuumQuiet(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, VacuumSuctionLevel.QUIET);
  },

  async vacuumStandard(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, VacuumSuctionLevel.STANDARD);
  },

  async vacuumStrong(device) {
    return this.vacuumSetSuctionLevel(device.mac, device.product_model, VacuumSuctionLevel.STRONG);
  },

  async vacuumInfo(device) {
    return this.getVacuumInfo(device.mac);
  },

  // ---- Pure accessors (operate on a getVacuumInfo() result) ----------------

  vacuumGetBattery(info) {
    // "battary" is the literal Wyze key (typo preserved by the server).
    return typeof info?.battary === "number" ? info.battary : null;
  },

  vacuumGetMode(info) {
    return parseVacuumMode(info?.mode);
  },

  vacuumGetFault(info) {
    const code = info?.fault_code;
    if (typeof code !== "number" || code === 0) return null;
    return { code, description: VacuumFaultCode[code] ?? null };
  },

  vacuumIsCharging(info) {
    return Boolean(info?.chargeState);
  },

  vacuumIsCleaning(info) {
    return this.vacuumGetMode(info) === "CLEANING";
  },

  vacuumIsDocked(info) {
    const mode = this.vacuumGetMode(info);
    return mode === "IDLE" || this.vacuumIsCharging(info);
  },
};
