const constants = require("../constants");
const {
  VacuumControlType,
  VacuumControlValue,
  VacuumPreferenceType,
  VacuumSuctionLevel,
  VacuumIotPropKeys,
  VacuumDeviceInfoKeys,
  VacuumControlTypeDescription,
} = require("../types");

/**
 * Wyze Robot Vacuum (JA_RO2) — talks to the Venus service via
 * `_venusRequest` (mixed in from services/venus.js).
 */
module.exports = {
  /**
   * Opt-in analytics ping that mirrors what the Wyze app fires after each
   * vacuum control action. Not required for controls to take effect.
   */
  async vacuumEventTracking(mac, typeCode, valueCode, args = []) {
    const payload = {
      uuid: constants.vacuumEventTrackingUuid,
      deviceId: mac,
      createTime: String(Date.now()),
      mcuSysVersion: constants.vacuumFirmwareVersion,
      appVersion: this.appVersion,
      pluginVersion: constants.venusPluginVersion,
      phoneId: this.phoneId,
      phoneOsVersion: "16.0",
      eventKey: VacuumControlTypeDescription[typeCode],
      eventType: valueCode,
    };
    args.forEach((value, index) => {
      payload[`arg${index + 1}`] = value;
    });
    payload.arg11 = "ios";
    payload.arg12 = "iPhone 13 mini";
    return this._venusRequest("POST", "/plugin/venus/event_tracking", payload);
  },

  async getVacuumDeviceList() {
    const devices = await this.getDeviceList();
    return devices.filter((d) => constants.vacuumModels.includes(d.product_model));
  },

  async getVacuum(mac) {
    const vacuums = await this.getVacuumDeviceList();
    return vacuums.find((v) => v.mac === mac);
  },

  /**
   * Combined snapshot — list entry + iot props + device info + status +
   * position + map. Tolerates partial sub-fetch failures.
   */
  async getVacuumInfo(mac) {
    const vacuum = await this.getVacuum(mac);
    if (!vacuum) return null;

    const result = { ...vacuum };
    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        this.log.warning(`getVacuumInfo: ${label} failed: ${err.message}`);
        return null;
      }
    };

    const iotProp = await safe("get_iot_prop", () =>
      this.getVacuumIotProp(mac, VacuumIotPropKeys)
    );
    if (iotProp?.data?.props) Object.assign(result, iotProp.data.props);

    const deviceInfo = await safe("device_info", () =>
      this.getVacuumDeviceInfo(mac, VacuumDeviceInfoKeys)
    );
    if (deviceInfo?.data?.settings) Object.assign(result, deviceInfo.data.settings);

    const status = await safe("status", () => this.getVacuumStatus(mac));
    if (status?.data?.eventFlag) Object.assign(result, status.data.eventFlag);
    if (status?.data?.heartBeat) Object.assign(result, status.data.heartBeat);

    const position = await safe("current_position", () =>
      this.getVacuumCurrentPosition(mac)
    );
    if (position?.data) result.current_position = position.data;

    const map = await safe("current_map", () => this.getVacuumCurrentMap(mac));
    if (map?.data) result.current_map = map.data;

    return result;
  },

  async getVacuumIotProp(mac, keys) {
    const params = { did: mac };
    if (keys != null) params.keys = Array.isArray(keys) ? keys.join(",") : keys;
    return this._venusRequest("GET", "/plugin/venus/get_iot_prop", params);
  },

  async getVacuumDeviceInfo(mac, keys) {
    const params = { device_id: mac };
    if (keys != null) params.keys = Array.isArray(keys) ? keys.join(",") : keys;
    return this._venusRequest("GET", "/plugin/venus/device_info", params);
  },

  async getVacuumStatus(mac) {
    return this._venusRequest("GET", `/plugin/venus/${mac}/status`);
  },

  async getVacuumCurrentPosition(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/current_position", { did: mac });
  },

  async getVacuumCurrentMap(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/current_map", { did: mac });
  },

  async getVacuumMaps(mac) {
    return this._venusRequest("GET", "/plugin/venus/memory_map/list", { did: mac });
  },

  async setVacuumCurrentMap(mac, mapId) {
    return this._venusRequest("POST", "/plugin/venus/memory_map/current_map", {
      device_id: mac,
      map_id: mapId,
    });
  },

  /**
   * Sweep history.
   * @param {Object} [options]
   * @param {number} [options.limit=20]
   * @param {Date|number} [options.since] — defaults to now
   */
  async getVacuumSweepRecords(mac, options = {}) {
    const { limit = 20, since = Date.now() } = options;
    const lastTime = since instanceof Date ? since.getTime() : since;
    return this._venusRequest("GET", "/plugin/venus/sweep_record/query_data", {
      did: mac,
      purpose: "history_map",
      count: limit,
      last_time: lastTime,
    });
  },

  /**
   * Low-level control. Prefer the named methods unless you specifically
   * need AREA_CLEAN or QUICK_MAPPING.
   */
  async vacuumControl(mac, type, value, extras = {}) {
    const payload = { type, value, vacuumMopMode: 0, ...extras };
    return this._venusRequest("POST", `/plugin/venus/${mac}/control`, payload);
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

  /**
   * @param {number} level — see VacuumSuctionLevel (1=Quiet, 2=Standard, 3=Strong)
   */
  async vacuumSetSuctionLevel(mac, model, level) {
    return this._venusRequest("POST", "/plugin/venus/set_iot_action", {
      did: mac,
      model,
      cmd: "set_preference",
      params: [{ ctrltype: VacuumPreferenceType.SUCTION, value: level }],
      is_sub_device: 0,
    });
  },

};
