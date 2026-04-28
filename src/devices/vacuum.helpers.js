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

  /**
   * Returns the room list for the vacuum's currently-active map as a
   * flat array of `{ id, name, mapId, mapName }`. Multi-floor users can
   * have several stored maps; this returns just the rooms for whichever
   * map the vacuum has loaded right now (the one with current_map === true).
   *
   * Returns [] (not null) when the vacuum has no rooms — fresh setup,
   * map deleted in the app, or response shape we don't recognize. Lets
   * callers iterate without null-checks.
   */
  async getVacuumRooms(mac) {
    const response = await this.getVacuumMaps(mac);
    // Wyze nests the actual list a couple of layers down and the shape
    // has shifted across firmwares — accept either {data: {data: [...]}}
    // or {data: [...]} so we don't fall over the next time they tweak.
    const maps =
      (Array.isArray(response?.data?.data) && response.data.data) ||
      (Array.isArray(response?.data) && response.data) ||
      [];
    if (maps.length === 0) return [];

    const current = maps.find((m) => m?.current_map === true) || maps[0];
    const rooms = Array.isArray(current?.room_info_list) ? current.room_info_list : [];
    return rooms
      .filter((r) => r && (r.room_id != null || r.id != null))
      .map((r) => ({
        id: r.room_id ?? r.id,
        name: String(r.room_name ?? r.name ?? `Room ${r.room_id ?? r.id}`),
        mapId: current.map_id,
        mapName: current.user_map_name || null,
      }));
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
