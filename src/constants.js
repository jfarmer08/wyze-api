const packageVersion = require('../package.json').version

module.exports = Object.freeze({
  // Crypto Secrets
  fordAppKey: "275965684684dbdaf29a0ed9", // Required for Locks
  fordAppSecret: "4deekof1ba311c5c33a9cb8e12787e8c", // Required for Locks
  oliveSigningSecret: "wyze_app_secret_key_132", // Required for the thermostat
  oliveAppId: "9319141212m2ik", //  Required for the thermostat
  appInfo: "wyze_android_2.19.14", // Required for the thermostat
  //vacuum
  venusAppId: "venp_4c30f812828de875",
  venusPluginVersion: "2.35.1",
  vacuumFirmwareVersion: "1.6.113",
  venusSigningSecret: "CVCSNoa0ALsNEpgKls6ybVTVOmGzFoiq",

  // App emulation constants
  phoneId: "wyze_developer_api",
  appName: "com.hualai.WyzeCam",
  appVer: "wyze_developer_api",
  appVersion: "wyze_developer_api",
  sc: "wyze_developer_api",
  sv: "wyze_developer_api",
  authApiKey: "WMXHYf79Nr5gIlt3r0r7p9Tcw5bvs6BB4U8O8nGJ",
  userAgent: "unofficial-wyze-api/" + packageVersion,
  phoneOsVersion: '16.0',
  //URLs
  authBaseUrl: "https://auth-prod.api.wyze.com",
  apiBaseUrl: "https://api.wyzecam.com",
  venusService: "https://wyze-venus-service-vn.wyzecam.com",
});
