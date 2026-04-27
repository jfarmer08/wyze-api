const payloadFactory = require("../payloadFactory");
const constants = require("../constants");

/**
 * Wyze Sprinkler — olive-signed against the lockwood service.
 * Each method is a thin wrapper over `_oliveSignedGet` / `_oliveSignedPost`
 * (mixed in from services/olive.js).
 */
module.exports = {
  async irrigationGetIotProp(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys =
      "zone_state,iot_state,iot_state_update_time,app_version,RSSI,wifi_mac,sn,device_model,ssid,IP";
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}get_iot_prop`,
      payload,
      "IrrigationGetIotProp"
    );
  },

  async irrigationGetDeviceInfo(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    payload.keys =
      "wiring,sensor,enable_schedules,notification_enable,notification_watering_begins,notification_watering_ends,notification_watering_is_skipped,skip_low_temp,skip_wind,skip_rain,skip_saturation";
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}device_info`,
      payload,
      "IrrigationGetDeviceInfo"
    );
  },

  async irrigationGetZones(deviceMac) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigation(deviceMac);
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}zone`,
      payload,
      "IrrigationGetZones"
    );
  },

  async irrigationQuickRun(deviceMac, zoneNumber, duration) {
    const payload = payloadFactory.oliveCreatePostPayloadIrrigationQuickRun(
      deviceMac,
      zoneNumber,
      duration
    );
    return this._oliveSignedPost(
      `${constants.irrigationBaseUrl}quickrun`,
      payload,
      "IrrigationQuickRun"
    );
  },

  async irrigationStop(deviceMac) {
    const payload = payloadFactory.oliveCreatePostPayloadIrrigationStop(deviceMac, "STOP");
    return this._oliveSignedPost(
      `${constants.irrigationBaseUrl}runningschedule`,
      payload,
      "IrrigationStop"
    );
  },

  async irrigationGetScheduleRuns(deviceMac, limit = 2) {
    const payload = payloadFactory.oliveCreateGetPayloadIrrigationScheduleRuns(deviceMac);
    payload.limit = limit;
    return this._oliveSignedGet(
      `${constants.irrigationBaseUrl}schedule_runs`,
      payload,
      "IrrigationGetScheduleRuns"
    );
  },
};
