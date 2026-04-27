/**
 * High-level helpers for HMS — orchestrate the low-level endpoints in hms.js
 * into single-call operations.
 */
module.exports = {
  async getHmsID() {
    return this.getPlanBindingListByUser();
  },

  /**
   * @param {string} hms_id
   * @param {string} mode — "off" / "home" / "away"
   */
  async setHMSState(hms_id, mode) {
    if (mode === "off") {
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
