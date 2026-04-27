const payloadFactory = require("../payloadFactory");
const types = require("../types");

// Default key sets for Earth-service reads. Mirrors what the thermostat
// app reads at home-screen render time.
const THERMOSTAT_DEVICE_INFO_KEYS = [
  "device_id", "device_type", "model", "mac", "firmware_ver", "main_device", "ip", "ssid",
];

const ROOM_SENSOR_PROP_KEYS = ["temperature", "humidity", "battery", "rssi", "iot_state"];

function validateOneOf(value, allowed, label) {
  const list = Object.values(allowed);
  if (!list.includes(value)) {
    throw new Error(
      `${label}: ${JSON.stringify(value)} is not a valid value (expected one of ${list.map((v) => JSON.stringify(v)).join(", ")})`
    );
  }
}

/**
 * Wyze Thermostat (CO_EA1) and Room Sensor (CO_TH1).
 *
 * Read methods route through `_earthGet` (services/olive.js wraps the
 * Earth service); writes go through `_earthPost`. Typed setters validate
 * against the enums in `src/types.js`.
 */
module.exports = {
  async thermostatGetIotProp(deviceMac) {
    const keys =
      "trigger_off_val,emheat,temperature,humidity,time2temp_val,protect_time,mode_sys,heat_sp,cool_sp, current_scenario,config_scenario,temp_unit,fan_mode,iot_state,w_city_id,w_lat,w_lon,working_state, dev_hold,dev_holdtime,asw_hold,app_version,setup_state,wiring_logic_id,save_comfort_balance, kid_lock,calibrate_humidity,calibrate_temperature,fancirc_time,query_schedule";
    const payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    return this._earthGet("/plugin/earth/get_iot_prop", payload);
  },

  async thermostatSetIotProp(deviceMac, deviceModel, propKey, value) {
    const payload = payloadFactory.oliveCreatePostPayload(deviceMac, deviceModel, propKey, value);
    return this._earthPost("/plugin/earth/set_iot_prop_by_topic", payload);
  },

  /**
   * Read device-level info (firmware, MAC, IP, SSID, etc.).
   */
  async getThermostatDeviceInfo(deviceMac, keys = THERMOSTAT_DEVICE_INFO_KEYS) {
    const params = {
      device_id: deviceMac,
      keys: Array.isArray(keys) ? keys.join(",") : keys,
    };
    return this._earthGet("/plugin/earth/device_info", params);
  },

  /**
   * List the room sensors (CO_TH1) paired with a thermostat.
   */
  async getThermostatSensors(deviceMac) {
    return this._earthGet("/plugin/earth/get_sub_device", { device_id: deviceMac });
  },

  /**
   * Combined snapshot — list entry + iot props + device info. Tolerates
   * partial sub-fetch failures.
   */
  async getThermostatInfo(mac) {
    const devices = await this.getDeviceList();
    const tstat = devices.find(
      (d) => d.mac === mac && types.DeviceModels.THERMOSTAT.includes(d.product_model)
    );
    if (!tstat) return null;

    const result = { ...tstat };
    const safe = async (label, fn) => {
      try {
        return await fn();
      } catch (err) {
        this.log.warning(`getThermostatInfo: ${label} failed: ${err.message}`);
        return null;
      }
    };

    const iot = await safe("iot_prop", () => this.thermostatGetIotProp(tstat.mac));
    if (iot?.data?.props) Object.assign(result, iot.data.props);

    const info = await safe("device_info", () => this.getThermostatDeviceInfo(tstat.mac));
    if (info?.data?.settings) Object.assign(result, info.data.settings);

    return result;
  },

  // ---- Typed setters --------------------------------------------------------

  /**
   * Set the system mode — `auto` / `cool` / `heat` / `off`.
   */
  async setThermostatSystemMode(deviceMac, deviceModel, mode) {
    validateOneOf(mode, types.ThermostatSystemMode, "setThermostatSystemMode");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "mode_sys", mode);
  },

  /**
   * Set the fan mode — `auto` / `circ` / `on`.
   */
  async setThermostatFanMode(deviceMac, deviceModel, mode) {
    validateOneOf(mode, types.ThermostatFanMode, "setThermostatFanMode");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "fan_mode", mode);
  },

  /**
   * Set the active scenario — `home` / `away` / `sleep`.
   */
  async setThermostatScenario(deviceMac, deviceModel, scenario) {
    validateOneOf(scenario, types.ThermostatScenarioType, "setThermostatScenario");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "current_scenario", scenario);
  },

  /**
   * Set the heating setpoint. Tenths-of-°F regardless of display unit
   * (e.g. 680 = 68.0°F).
   */
  async setThermostatHeatingSetpoint(deviceMac, deviceModel, value) {
    if (!Number.isInteger(value)) {
      throw new Error("setThermostatHeatingSetpoint: value must be an integer (tenths of °F)");
    }
    return this.thermostatSetIotProp(deviceMac, deviceModel, "heat_sp", value);
  },

  /**
   * Set the cooling setpoint (tenths-of-°F).
   */
  async setThermostatCoolingSetpoint(deviceMac, deviceModel, value) {
    if (!Number.isInteger(value)) {
      throw new Error("setThermostatCoolingSetpoint: value must be an integer (tenths of °F)");
    }
    return this.thermostatSetIotProp(deviceMac, deviceModel, "cool_sp", value);
  },

  /**
   * Set both setpoints in one call (sequential writes).
   */
  async setThermostatTemperature(deviceMac, deviceModel, coolingSetpoint, heatingSetpoint) {
    await this.setThermostatCoolingSetpoint(deviceMac, deviceModel, coolingSetpoint);
    await this.setThermostatHeatingSetpoint(deviceMac, deviceModel, heatingSetpoint);
  },

  /**
   * Toggle the child-lock (kid_lock).
   */
  async setThermostatLock(deviceMac, deviceModel, locked) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "kid_lock", locked ? "1" : "0");
  },

  /**
   * Comfort-balance behavior (Settings → Behavior). 1–5.
   */
  async setThermostatComfortBalance(deviceMac, deviceModel, mode) {
    validateOneOf(mode, types.ThermostatComfortBalanceMode, "setThermostatComfortBalance");
    return this.thermostatSetIotProp(deviceMac, deviceModel, "save_comfort_balance", mode);
  },

  /**
   * Hold the current setpoint until a specific time (manual hold).
   * Sets `dev_hold` true and `dev_holdtime` to the given epoch.
   */
  async holdThermostat(deviceMac, deviceModel, until) {
    const ts = until instanceof Date ? until.getTime() : until;
    if (!Number.isFinite(ts)) {
      throw new Error("holdThermostat: `until` must be a Date or epoch ms");
    }
    await this.thermostatSetIotProp(deviceMac, deviceModel, "dev_hold", "1");
    await this.thermostatSetIotProp(deviceMac, deviceModel, "dev_holdtime", String(ts));
  },

  /**
   * Clear an active manual hold.
   */
  async clearThermostatHold(deviceMac, deviceModel) {
    return this.thermostatSetIotProp(deviceMac, deviceModel, "dev_hold", "0");
  },

  // ---- Device-object helpers -----------------------------------------------

  async thermostatSystemMode(device, mode) {
    return this.setThermostatSystemMode(device.mac, device.product_model, mode);
  },

  async thermostatFanMode(device, mode) {
    return this.setThermostatFanMode(device.mac, device.product_model, mode);
  },

  async thermostatScenario(device, scenario) {
    return this.setThermostatScenario(device.mac, device.product_model, scenario);
  },

  async thermostatHeatingSetpoint(device, value) {
    return this.setThermostatHeatingSetpoint(device.mac, device.product_model, value);
  },

  async thermostatCoolingSetpoint(device, value) {
    return this.setThermostatCoolingSetpoint(device.mac, device.product_model, value);
  },

  async thermostatTemperature(device, coolingSetpoint, heatingSetpoint) {
    return this.setThermostatTemperature(device.mac, device.product_model, coolingSetpoint, heatingSetpoint);
  },

  async thermostatLock(device, locked) {
    return this.setThermostatLock(device.mac, device.product_model, locked);
  },

  async thermostatComfortBalance(device, mode) {
    return this.setThermostatComfortBalance(device.mac, device.product_model, mode);
  },

  async thermostatHold(device, until) {
    return this.holdThermostat(device.mac, device.product_model, until);
  },

  async thermostatClearHold(device) {
    return this.clearThermostatHold(device.mac, device.product_model);
  },
};

// Expose default key sets so external callers can use them too.
module.exports.THERMOSTAT_DEVICE_INFO_KEYS = THERMOSTAT_DEVICE_INFO_KEYS;
module.exports.ROOM_SENSOR_PROP_KEYS = ROOM_SENSOR_PROP_KEYS;
