const payloadFactory = require("../utils/payloadFactory");

/**
 * Wyze Home Monitoring System (HMS).
 *
 * High-level (`setHMSState`, `getHmsID`, `getHmsUpdate`) wraps the
 * lower-level membership / monitoring / reme-alarm endpoints. All call
 * paths route through `_hmsRequest` (services/hms.js) or
 * `_oliveSignedGet` (services/olive.js).
 */
module.exports = {
  // ---- Low-level endpoints --------------------------------------------------

  async disableRemeAlarm(hms_id) {
    return this._hmsRequest("delete", "https://hms.api.wyze.com/api/v1/reme-alarm", {
      body: { hms_id, remediation_id: "emergency" },
      label: "DisableRemeAlarm",
    });
  },

  async getPlanBindingListByUser() {
    const payload = payloadFactory.oliveCreateHmsPayload();
    return this._oliveSignedGet(
      "https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user",
      payload,
      "GetPlanBindingListByUser"
    );
  },

  async monitoringProfileStateStatus(hms_id) {
    const params = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    return this._hmsRequest(
      "get",
      "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status",
      { params, sign: true, contentType: true, label: "MonitoringProfileStateStatus" }
    );
  },

  async monitoringProfileActive(hms_id, home, away) {
    const params = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const body = [
      { state: "home", active: home },
      { state: "away", active: away },
    ];
    return this._hmsRequest(
      "patch",
      "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/active",
      { params, body, sign: true, label: "MonitoringProfileActive" }
    );
  },

  // ---- High-level helpers --------------------------------------------------

  async getHmsID() {
    await this.getPlanBindingListByUser();
  },

  /**
   * @param {string} mode — "off" / "home" / "away"
   */
  async setHMSState(hms_id, mode) {
    if (mode == "off") {
      await this.disableRemeAlarm(hms_id);
      await this.monitoringProfileActive(hms_id, 0, 0);
    } else if (mode === "away") {
      await this.monitoringProfileActive(hms_id, 0, 1);
    } else if (mode === "home") {
      await this.monitoringProfileActive(hms_id, 1, 0);
    }
  },

  async getHmsUpdate(hms_id) {
    return this.monitoringProfileStateStatus(hms_id);
  },
};
