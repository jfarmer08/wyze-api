const constants = require("../constants");
const {
  VacuumSuctionLevel,
  VacuumFaultCode,
  VacuumControlType,
  VacuumControlValue,
  parseVacuumMode,
} = require("../types");

/**
 * Device-object helpers for the robot vacuum.
 * Async methods accept a `device` object; pure accessors accept the merged
 * result of getVacuumInfo().
 *
 * MAC-level helpers (getVacuumDeviceList, vacuumClean, vacuumDock, etc.) are
 * also collected here since they are all thin wrappers around vacuumControl or
 * getDeviceList filters.
 */
module.exports = {
  // ---- MAC-level helpers ---------------------------------------------------

  async getVacuumDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => constants.vacuumModels.includes(d.product_model));
  },

  async getVacuum(mac) {
    const vacuums = await this.getVacuumDeviceList();
    return vacuums.find((v) => v.mac === mac);
  },

  async vacuumClean(mac) {
    return this.vacuumControl(mac, VacuumControlType.GLOBAL_SWEEPING, VacuumControlValue.START);
  },

  async vacuumPause(mac) {
    return this.vacuumControl(mac, VacuumControlType.GLOBAL_SWEEPING, VacuumControlValue.PAUSE);
  },

  async vacuumDock(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.START);
  },

  async vacuumStop(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.STOP);
  },

  /**
   * Cancel a pending "resume after charging" state. Same wire payload as
   * vacuumStop; named separately for caller clarity.
   */
  async vacuumCancel(mac) {
    return this.vacuumControl(mac, VacuumControlType.RETURN_TO_CHARGING, VacuumControlValue.STOP);
  },

  async vacuumSweepRooms(mac, roomIds) {
    const ids = Array.isArray(roomIds) ? roomIds : [roomIds];
    return this.vacuumControl(
      mac,
      VacuumControlType.GLOBAL_SWEEPING,
      VacuumControlValue.START,
      { rooms_id: ids }
    );
  },

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
