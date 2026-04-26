const packageVersion = require('../package.json').version;

module.exports = Object.freeze({
  // Crypto Secrets (Required for device communication)
  fordAppKey: "275965684684dbdaf29a0ed9", // Required for Locks
  fordAppSecret: "4deekof1ba311c5c33a9cb8e12787e8c", // Required for Locks
  oliveSigningSecret: "wyze_app_secret_key_132", // Required for the thermostat
  oliveAppId: "9319141212m2ik", // Required for the thermostat
  webSigningSecret: "gbJojEBViLklgwyyDikx5ztSvKBXI5oU", // Required for camera WebRTC stream info
  webAppId: "strv_e7f78e9e7738dc50", // Required for camera WebRTC stream info
  webAppInfo: "wyze_web_2.3.1", // Required for camera WebRTC stream info

  // Wyze response codes (from wyzeapy types.py ResponseCodes enum)
  deviceOfflineCode: "3019",

  // Application Information (for emulation)
  appInfo: "wyze_android_2.19.14", // Required for the thermostat
  phoneId: "wyze_developer_api",
  appName: "com.hualai.WyzeCam",
  appVer: "wyze_developer_api",
  appVersion: "wyze_developer_api",
  sc: "wyze_developer_api",
  sv: "wyze_developer_api",
  authApiKey: "WMXHYf79Nr5gIlt3r0r7p9Tcw5bvs6BB4U8O8nGJ",
  userAgent: `unofficial-wyze-api/${packageVersion}`,

  // Base URLs for API requests
  authBaseUrl: "https://auth-prod.api.wyze.com",
  apiBaseUrl: "https://api.wyzecam.com",
  irrigationBaseUrl: "https://wyze-lockwood-service.wyzecam.com/plugin/irrigation/",

  // IoT3 API (used by Lock Bolt V2 and Palm lock)
  iot3BaseUrl: "https://app.wyzecam.com",
  iot3AppVersion: "3.11.0.758",
  iot3AppInfo: "wyze_android_3.11.0.758",

  // Venus service (Wyze Robot Vacuum, e.g. JA_RO2)
  venusBaseUrl: "https://wyze-venus-service-vn.wyzecam.com",
  venusAppId: "venp_4c30f812828de875",
  venusSigningSecret: "CVCSNoa0ALsNEpgKls6ybVTVOmGzFoiq",
  vacuumModels: ["JA_RO2"],
  // Emulation constants used by /plugin/venus/event_tracking. Mirrored from
  // wyze-sdk's VenusServiceClient class fields.
  venusPluginVersion: "2.35.1",
  vacuumFirmwareVersion: "1.6.113",
  vacuumEventTrackingUuid: "88DBF3344D20B5597DB7C8F0AFBB4030",
});
