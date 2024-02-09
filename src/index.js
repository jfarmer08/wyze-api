const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const getUuid = require("uuid-by-string");

const payloadFactory = require("./payloadFactory");
const crypto = require("./crypto");
const constants = require("./constants");
const util = require("./util");
const { time } = require("console");

module.exports = class WyzeAPI {
  constructor(options, log) {
    this.log = log;
    this.persistPath = options.persistPath;
    this.refreshTokenTimerEnabled = options.refreshTokenTimerEnabled || false;
    this.lowBatteryPercentage = options.lowBatteryPercentage || 30;
    // User login parameters
    this.username = options.username;
    this.password = options.password;
    this.mfaCode = options.mfaCode;
    this.apiKey = options.apiKey;
    this.keyId = options.keyId;

    // Logging
    this.logLevel = options.logLevel;
    this.apiLogEnabled = options.apiLogEnabled;

    // URLs
    this.authBaseUrl = options.authBaseUrl || constants.authBaseUrl;
    this.apiBaseUrl =
      options.apiBaseUrl || options.baseUrl || constants.apiBaseUrl;

    // App emulation constants
    this.authApiKey = options.authApiKey || constants.authApiKey;
    this.phoneId = options.phoneId || constants.phoneId;
    this.appName = options.appName || constants.appName;
    this.appVer = options.appVer || constants.appVer;
    this.appVersion = options.appVersion || constants.appVersion;
    this.userAgent = options.userAgent || constants.userAgent;
    this.sc = options.sc || constants.sc;
    this.sv = options.sv || constants.sv;

    // Crypto Secrets
    this.fordAppKey = options.fordAppKey || constants.fordAppKey; // Required for Locks
    this.fordAppSecret = options.fordAppSecret || constants.fordAppSecret; // Required for Locks
    this.oliveSigningSecret =
      options.oliveSigningSecret || constants.oliveSigningSecret; // Required for the thermostat
    this.oliveAppId = options.oliveAppId || constants.oliveAppId; //  Required for the thermostat
    this.appInfo = options.appInfo || constants.appInfo; // Required for the thermostat

    // Login tokens
    this.access_token = "";
    this.refresh_token = "";

    this.dumpData = false; // Set this to true to log the Wyze object data blob one time at startup.

    this.lastLoginAttempt = 0;
    this.loginAttemptDebounceMilliseconds = 1000;

    // Token is good for 216,000 seconds (60 hours) but 48 hours seems like a reasonable refresh interval 172800
    if (this.refreshTokenTimerEnabled === true) {
      setInterval(this.refreshToken.bind(this), 172800);
    }
  }

  getRequestData(data = {}) {
    return {
      access_token: this.access_token,
      app_name: this.appName,
      app_ver: this.appVer,
      app_version: this.appVersion,
      phone_id: this.phoneId,
      phone_system_type: "1",
      sc: this.sc,
      sv: this.sv,
      ts: new Date().getTime(),
      ...data,
    };
  }

  async request(url, data = {}) {
    await this.maybeLogin();

    try {
      return await this._performRequest(url, this.getRequestData(data));
    } catch (e) {
      this.log.error(e);
      if (this.refresh_token) {
        this.log.error("Error, refreshing access token and trying again");

        try {
          await this.refreshToken();
          return await this._performRequest(url, this.getRequestData(data));
        } catch (e) {
          //
        }
      }

      this.log.error("Error, logging in and trying again");

      await this.login();
      return this._performRequest(url, this.getRequestData(data));
    }
  }

  async _performRequest(url, data = {}, config = {}) {
    config = {
      method: "POST",
      url,
      data,
      baseURL: this.apiBaseUrl,
      ...config,
    };

    if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
    if (this.apiLogEnabled)
      this.log.debug(`Request config: ${JSON.stringify(config)}`);

    let result;

    try {
      result = await axios(config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response PerformRequest: ${JSON.stringify(result.data)}`
        );
      if (this.dumpData) {
        if (this.apiLogEnabled)
          this.log.debug(
            `API response PerformRequest: ${JSON.stringify(result.data)}`
          );
        this.dumpData = false; // Only want to do this once at start-up
      }
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        this.log.error(
          `Response PerformRequest (${e.response}): ${JSON.stringify(
            e.response.data
          )}`
        );
      }

      throw e;
    }
    this.log.debug(result.data.msg)
    return result
  }

  _performLoginRequest(data = {}) {
    let url = "api/user/login";
    data = {
      email: this.username,
      password: util.createPassword(this.password),
      ...data,
    };

    const config = {
      baseURL: this.authBaseUrl,
      headers: {
        "x-api-key": this.authApiKey,
        apikey: this.apiKey,
        keyid: this.keyId,
        "User-Agent": this.userAgent,
      },
    };

    return this._performRequest(url, data, config);
  }

  async login() {
    let result;
    // Do we need apiKey or keyId?
    if (this.apiKey == null) {
      throw new Error(
        'ApiKey Required, Please provide the "apiKey" parameter in config.json'
      );
    } else if (this.keyId == null) {
      throw new Error(
        'KeyId Required, Please provide the "keyid" parameter in config.json'
      );
    } else {
      result = await this._performLoginRequest();
      if (
        result.data.description ==
        "Invalid credentials, please check username, password, keyid or apikey"
      ) {
        throw new Error(
          "Invalid credentials, please check username, password, keyid or apikey"
        );
      } else {
        if (this.apiLogEnabled)
          this.log.debug("Successfully logged into Wyze API");
        await this._updateTokens(result.data);
      }
    }
  }

  async maybeLogin() {
    if (!this.access_token) {
      await this._loadPersistedTokens();
    }

    if (!this.access_token) {
      let now = new Date().getTime();
      // check if the last login attempt occurred too recently
      if (this.apiLogEnabled)
        this.log.debug(
          "Last login " +
            this.lastLoginAttempt +
            " debounce " +
            this.loginAttemptDebounceMilliseconds +
            " now " +
            now
        );
      if (this.lastLoginAttempt + this.loginAttemptDebounceMilliseconds < now) {
        // reset loginAttemptDebounceMilliseconds if last attempted login occurred more than 12 hours ago
        if (this.lastLoginAttempt - now > 60 * 1000 * 60 * 12) {
          this.loginAttemptDebounceMilliseconds = 1000;
        } else {
          // max debounce of 5 minutes
          this.loginAttemptDebounceMilliseconds = Math.min(
            this.loginAttemptDebounceMilliseconds * 2,
            1000 * 60 * 5
          );
        }

        this.lastLoginAttempt = now;
        await this.login();
      } else {
        this.log.warning(
          "Attempting to login before debounce has cleared, waiting " +
            this.loginAttemptDebounceMilliseconds / 1000 +
            " seconds"
        );

        var waitTime = 0;
        while (waitTime < this.loginAttemptDebounceMilliseconds) {
          await this.sleep(2);
          waitTime = waitTime + 2000;
          if (this.access_token) {
            break;
          }
        }

        if (!this.access_token) {
          this.lastLoginAttempt = now;
          this.loginAttemptDebounceMilliseconds = Math.min(
            this.loginAttemptDebounceMilliseconds * 2,
            1000 * 60 * 5
          );
          await this.login();
        }
      }
    }
  }

  async refreshToken() {
    const data = {
      ...this.getRequestData(),
      refresh_token: this.refresh_token,
    };

    const result = await this._performRequest("app/user/refresh_token", data);

    await this._updateTokens(result.data.data);
  }

  async _updateTokens({ access_token, refresh_token }) {
    this.access_token = access_token;
    this.refresh_token = refresh_token;
    await this._persistTokens();
  }

  _tokenPersistPath() {
    // const uuid = 'test'
    const uuid = getUuid(this.username);
    return path.join(this.persistPath, `wyze-${uuid}.json`);
  }

  async _persistTokens() {
    const data = {
      access_token: this.access_token,
      refresh_token: this.refresh_token,
    };
    this.log.debug(this._tokenPersistPath());
    await fs.writeFile(this._tokenPersistPath(), JSON.stringify(data));
  }

  async _loadPersistedTokens() {
    try {
      let data = await fs.readFile(this._tokenPersistPath());
      data = JSON.parse(data);
      this.access_token = data.access_token;
      this.refresh_token = data.refresh_token;
    } catch (e) {
      //
    }
  }

  async getObjectList() {
    const result = await this.request("app/v2/home_page/get_object_list");

    return result.data;
  }

  async getPropertyList(deviceMac, deviceModel) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
    };

    const result = await this.request("app/v2/device/get_property_list", data);

    return result.data;
  }

  async setProperty(deviceMac, deviceModel, propertyId, propertyValue) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
      pid: propertyId,
      pvalue: propertyValue,
    };

    const result = await this.request("app/v2/device/set_property", data);
    return result.data;
  }

  async runAction(deviceMac, deviceModel, actionKey) {
    const data = {
      instance_id: deviceMac,
      provider_key: deviceModel,
      action_key: actionKey,
      action_params: {},
      custom_string: "",
    };

    if (this.apiLogEnabled)
      this.log.debug(`run_action Data Body: ${JSON.stringify(data)}`);

    const result = await this.request("app/v2/auto/run_action", data);

    return result.data;
  }

  async runActionList(
    deviceMac,
    deviceModel,
    propertyId,
    propertyValue,
    actionKey
  ) {
    const plist = [
      {
        pid: propertyId,
        pvalue: String(propertyValue),
      },
    ];
    if (propertyId !== "P3") {
      plist.push({
        pid: "P3",
        pvalue: "1",
      });
    }
    const innerList = [
      {
        mac: deviceMac,
        plist,
      },
    ];
    const actionParams = {
      list: innerList,
    };
    const actionList = [
      {
        instance_id: deviceMac,
        action_params: actionParams,
        provider_key: deviceModel,
        action_key: actionKey,
      },
    ];
    const data = {
      action_list: actionList,
    };
    if (this.apiLogEnabled)
      this.log.debug(`run_action_list Data Body: ${JSON.stringify(data)}`);

    const result = await this.request("app/v2/auto/run_action_list", data);

    return result.data;
  }

  async controlLock(deviceMac, deviceModel, action) {
    await this.maybeLogin();
    let path = "/openapi/lock/v1/control";

    let payload = {
      uuid: this.getUuid(deviceMac, deviceModel),
      action: action, // "remoteLock" or "remoteUnlock"
    };

    let result;

    try {
      payload = payloadFactory.fordCreatePayload(
        this.access_token,
        payload,
        path,
        "post"
      );

      let urlPath = "https://yd-saas-toc.wyzecam.com/openapi/lock/v1/control";
      result = await axios.post(urlPath, payload);
      if (this.apiLogEnabled)
        this.log(`API response ControLock: ${JSON.stringify(result.data)}`);
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log(
            `Response ControLock (${e.response.statusText}): ${JSON.stringify(
              e.response.data,
              null,
              "\t"
            )}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async getLockInfo(deviceMac, deviceModel) {
    await this.maybeLogin();

    let result;
    let url_path = "/openapi/lock/v1/info";

    let payload = {
      uuid: this.getUuid(deviceMac, deviceModel),
      with_keypad: "1",
    };
    try {
      let config = {
        params: payload,
      };
      payload = payloadFactory.fordCreatePayload(
        this.access_token,
        payload,
        url_path,
        "get"
      );

      const url = "https://yd-saas-toc.wyzecam.com/openapi/lock/v1/info";
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response GetLockInfo: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        if (this.apiLogEnabled)
          this.log(
            `Response GetLockInfo (${e.response.statusText}): ${JSON.stringify(
              e.response.data,
              null,
              "\t"
            )}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async getIotProp(deviceMac) {
    let keys =
      "iot_state,switch-power,switch-iot,single_press_type, double_press_type, triple_press_type, long_press_type";
    await this.maybeLogin();
    let result;
    let payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      let url =
        "https://wyze-sirius-service.wyzecam.com/plugin/sirius/get_iot_prop";
      if (this.apiLogEnabled) this.log(`Performing request: ${url}`);
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log(`API response GetIotProp: ${JSON.stringify(result.data)}`);
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log(
            `Response GetIotProp (${e.response.statusText}): ${JSON.stringify(
              e.response.data,
              null,
              "\t"
            )}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async setIotProp(deviceMac, product_model, propKey, value) {
    await this.maybeLogin();
    let result;
    let payload = payloadFactory.oliveCreatePostPayload(
      deviceMac,
      product_model,
      propKey,
      value
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );

    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": "myapp",
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url =
        "https://wyze-sirius-service.wyzecam.com/plugin/sirius/set_iot_prop_by_topic";
      result = await axios.post(url, JSON.stringify(payload), config);
      //if(this.apiLogEnabled) this.log(`API response SetIotProp: ${JSON.stringify(result.data)}`)
      console.result;
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        //if(this.apiLogEnabled) this.log(`Response SetIotProp (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
        console.log(e.response);
      }
      throw e;
    }
    return result.data;
  }

  async getUserProfile() {
    await this.maybeLogin();

    let result;
    let payload = payloadFactory.oliveCreateUserInfoPayload();
    let signature = crypto.oliveCreateSignature(payload, this.access_token);

    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": "myapp",
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      let url =
        "https://wyze-platform-service.wyzecam.com/app/v2/platform/get_user_profile";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response GetUserProfile: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response GetUserProfile (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async disableRemeAlarm(hms_id) {
    await this.maybeLogin();
    let result;
    let config = {
      headers: {
        Authorization: this.access_token,
        "User-Agent": this.userAgent,
      },
      data: {
        hms_id: hms_id,
        remediation_id: "emergency",
      },
    };
    try {
      const url = "https://hms.api.wyze.com/api/v1/reme-alarm";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.delete(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response DisableRemeAlarm: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);
      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response DisableRemeAlarm (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async getPlanBindingListByUser() {
    await this.maybeLogin();
    let result;
    let payload = payloadFactory.oliveCreateHmsPayload();
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };

    try {
      const url =
        "https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response GetPlanBindingListByUser: ${JSON.stringify(
            result.data
          )}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response GetPlanBindingListByUser (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async monitoringProfileStateStatus(hms_id) {
    await this.maybeLogin();
    let result;
    let query = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    let signature = crypto.oliveCreateSignature(query, this.access_token);

    let config = {
      headers: {
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
        Authorization: this.access_token,
        "Content-Type": "application/json",
      },
      params: query,
    };

    try {
      const url =
        "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response MonitoringProfileStateStatus: ${JSON.stringify(
            result.data
          )}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response MonitoringProfileStateStatus (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async monitoringProfileActive(hms_id, home, away) {
    await this.maybeLogin();
    let result;
    const payload = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const signature = crypto.oliveCreateSignature(payload, this.access_token);

    const config = {
      headers: {
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: constants.phoneId,
        access_token: this.access_token,
        signature2: signature,
        Authorization: this.access_token,
      },
      params: payload,
    };

    const data = [
      {
        state: "home",
        active: home,
      },
      {
        state: "away",
        active: away,
      },
    ];

    try {
      const url =
        "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/active";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.patch(url, data, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response MonitoringProfileActive: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response MonitoringProfileActive (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async thermostatGetIotProp(deviceMac) {
    await this.maybeLogin();
    let result;
    let keys =
      "trigger_off_val,emheat,temperature,humidity,time2temp_val,protect_time,mode_sys,heat_sp,cool_sp, current_scenario,config_scenario,temp_unit,fan_mode,iot_state,w_city_id,w_lat,w_lon,working_state, dev_hold,dev_holdtime,asw_hold,app_version,setup_state,wiring_logic_id,save_comfort_balance, kid_lock,calibrate_humidity,calibrate_temperature,fancirc_time,query_schedule";
    let payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        "Accept-Encoding": "gzip",
        "User-Agent": this.userAgent,
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: constants.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
      params: payload,
    };
    try {
      let url =
        "https://wyze-earth-service.wyzecam.com/plugin/earth/get_iot_prop";
      if (this.apiLogEnabled) this.log.debug(`Performing request: ${url}`);
      result = await axios.get(url, config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response ThermostatGetIotProp: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response ThermostatGetIotProp (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async thermostatSetIotProp(deviceMac, deviceModel, propKey, value) {
    await this.maybeLogin();
    let result;
    let payload = payloadFactory.oliveCreatePostPayload(
      deviceMac,
      deviceModel,
      propKey,
      value
    );
    let signature = crypto.oliveCreateSignatureSingle(
      JSON.stringify(payload),
      this.access_token
    );
    const config = {
      headers: {
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "User-Agent": "myapp",
        appid: constants.oliveAppId,
        appinfo: constants.appInfo,
        phoneid: this.phoneId,
        access_token: this.access_token,
        signature2: signature,
      },
    };

    try {
      const url =
        "https://wyze-earth-service.wyzecam.com/plugin/earth/set_iot_prop_by_topic";
      result = await axios.post(url, JSON.stringify(payload), config);
      if (this.apiLogEnabled)
        this.log.debug(
          `API response ThermostatSetIotProp: ${JSON.stringify(result.data)}`
        );
    } catch (e) {
      this.log.error(`Request failed: ${e}`);

      if (e.response) {
        if (this.apiLogEnabled)
          this.log.debug(
            `Response ThermostatSetIotProp (${
              e.response.statusText
            }): ${JSON.stringify(e.response.data, null, "\t")}`
          );
      }
      throw e;
    }
    return result.data;
  }

  async localBulbCommand(
    deviceMac,
    deviceEnr,
    deviceIp,
    propertyId,
    propertyValue
  ) {
    const characteristics = {
      mac: deviceMac.toUpperCase(),
      index: "1",
      ts: String(Math.floor(Date.now() / 1000000)),
      plist: [
        {
          pid: propertyId,
          pvalue: String(propertyValue),
        },
      ],
    };

    const characteristics_str = JSON.stringify(characteristics);
    const characteristics_enc = util.encrypt(deviceEnr, characteristics_str);

    const payload = {
      request: "set_status",
      isSendQueue: 0,
      characteristics: characteristics_enc,
    };
    const payload_str = JSON.stringify(payload);

    const url = `http://${deviceIp}:88/device_request`;

    try {
      //const response = await fetch(url, { method: "POST",body: payload_str})
      let result = await axios.post(url, payload_str);
      if (this.apiLogEnabled)
        this.log.debug(`API response Local Bulb: ${result.data}`);
    } catch (error) {
      console.log(error);
      console.log(
        `Failed to connect to bulb ${deviceMac}, reverting to cloud.`
      );

      //await this.runActionList(bulb, plist)
    }
  }

  /**
   * Helper functions
   */

  getUuid(deviceMac, deviceModel) {
    return deviceMac.replace(`${deviceModel}.`, "");
  }

  async getObjects() {
    const result = await this.getObjectList();
    return result;
  }

  async getDeviceList() {
    const result = await this.getObjectList();
    return result.data.device_list;
  }

  async getDeviceByName(nickname) {
    const result = await this.getDeviceList();
    const device = result.find(
      (device) => device.nickname.toLowerCase() === nickname.toLowerCase()
    );
    return device;
  }

  async getDeviceByMac(mac) {
    const result = await this.getDeviceList();
    const device = result.find((device) => device.mac === mac);
    return device;
  }

  async getDevicesByType(type) {
    const result = await this.getDeviceList();
    const devices = result.filter(
      (device) => device.product_type.toLowerCase() === type.toLowerCase()
    );
    return devices;
  }

  async getDevicesByModel(model) {
    const result = await this.getDeviceList();
    const devices = result.filter(
      (device) => device.product_model.toLowerCase() === model.toLowerCase()
    );
    return devices;
  }

  async getDeviceGroupsList() {
    const result = await this.getObjectList();
    return result.data.device_group_list;
  }

  async getDeviceSortList() {
    const result = await this.getObjectList();
    return result.data.device_sort_list;
  }
  async getDeviceStatus(device) {
    return device.device_params;
  }

  async getDevicePID(deviceMac, deviceModel) {
    return await this.getPropertyList(deviceMac, deviceModel);
  }

  async cameraPrivacy(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  }
  async cameraTurnOn(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "power_on");
  }
  async cameraTurnOff(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "power_off");
  }

  /**
   * Open or Close Garage Door Depending on current state
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async garageDoor(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "garage_door_trigger");
  }

  async cameraSiren(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  }
  /**
   * Turn Camera Siren ON
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async cameraSirenOn(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "siren_on");
  }

  /**
   * Turn Camera Siren OFF
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async cameraSirenOff(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "siren_off");
  }

  async turnMeshOn(deviceMac, deviceModel) {
    return await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      "1",
      "set_mesh_property"
    );
  }
  async turnMeshOff(deviceMac, deviceModel) {
    return await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      "0",
      "set_mesh_property"
    );
  }

  async unlockLock(device) {
    return await this.controlLock(
      device.mac,
      device.product_model,
      "remoteUnlock"
    );
  }
  async lockLock(device) {
    return await this.controlLock(
      device.mac,
      device.product_model,
      "remoteLock"
    );
  }

  async lockInfo(device) {
    return await this.getLockInfo(device.mac, device.product_model);
  }

  async cameraFloodLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1056", value);
  }
  async cameraFloodLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "1");
  }
  async cameraFloodLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "2");
  }

  async cameraSpotLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1056", value);
  }
  async cameraSpotLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "1");
  }
  async cameraSpotLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1056", "2");
  }

  async cameraMotionOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1001", 1);
  }
  async cameraMotionOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1001", 0);
  }

  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1048", "1");
  }
  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1048", "0");
  }

  async cameraNotifications(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1", value);
  }
  async cameraNotificationsOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1", "1");
  }
  async cameraNotificationsOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1", "0");
  }

  async cameraMotionRecording(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1047", value);
  }
  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1047", "1");
  }
  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P1047", "0");
  }

  /**
   * Turn Plug 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async plugPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P3", value);
  }
  async plugTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "0");
  }
  async plugTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "1");
  }

  //WyzeLight
  /**
   * Turn Light Bulb 0 = off or 1 = on
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async lightPower(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P3", value);
  }
  async lightTurnOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "0");
  }
  async lightTurnOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, "P3", "1");
  }

  async setBrightness(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1501", value);
  }
  async setColorTemperature(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, "P1502", value);
  }

  /**
   * Turn Mesh Device on or off
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async lightMeshPower(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      value,
      "set_mesh_property"
    );
  }

  /**
   * Turn Mesh Device On
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async lightMeshOn(deviceMac, deviceModel) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      "1",
      "set_mesh_property"
    );
  }

  /**
   * Turn Mesh Device Off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async lightMeshOff(deviceMac, deviceModel) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P3",
      "0",
      "set_mesh_property"
    );
  }

  /**
   * Set Mesh Brightness 0 - 100
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async setMeshBrightness(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P1501",
      value,
      "set_mesh_property"
    );
  }

  /**
   * Set Color Temperature 2700 - 6500
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {number} value
   */
  async setMeshColorTemperature(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P1502",
      value,
      "set_mesh_property"
    );
  }

  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {*} value
   */
  async setMeshHue(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P1507",
      value,
      "set_mesh_property"
    );
  }

  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {*} value
   */
  async setMeshSaturation(deviceMac, deviceModel, value) {
    await this.runActionList(
      deviceMac,
      deviceModel,
      "P1507",
      value,
      "set_mesh_property"
    );
  }

  /**
   * Turn wall switch on or off
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async wallSwitchPower(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", value);
  }

  /**
   * Turn wall switch on
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchPowerOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", true);
  }

  /**
   * Turn wall switch off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchPowerOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-power", false);
  }
  /**
   *
   * @param {string} deviceMac
   * @param {string} deviceModel
   * @param {boolean} value
   */
  async wallSwitchIot(deviceMac, deviceModel, value) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", value);
  }
  async wallSwitchIotOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", true);
  }
  async wallSwitchIotOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "switch-iot", false);
  }

  async wallSwitchLedStateOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", true);
  }
  async wallSwitchLedStateOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "led_state", false);
  }

  /**
   * Wall Switch Turn Vacation Mode on
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchVacationModeOn(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 0);
  }

  /**
   * Wall Switch Turn Vacation Mode off
   * @param {string} deviceMac
   * @param {string} deviceModel
   */
  async wallSwitchVacationModeOff(deviceMac, deviceModel) {
    await this.setIotProp(deviceMac, deviceModel, "vacation_mode", 1);
  }

  async getHmsID() {
    await this.getPlanBindingListByUser();
  }

  async setHMSState(hms_id, mode) {
    if (mode == "off") {
      await this.disableRemeAlarm(hms_id);
      await this.monitoringProfileActive(hms_id, 0, 0);
    } else if (mode === "away") {
      await this.monitoringProfileActive(hms_id, 0, 1);
    } else if (mode === "home") {
      await this.monitoringProfileActive(hms_id, 1, 0);
    }
  }

  async getHmsUpdate(hms_id) {
    return await this.plugin.client.monitoringProfileStateStatus(hms_id);
  }

  async getDeviceState(device) {
    let state =
      device.device_params.power_switch !== undefined
        ? device.device_params.power_switch === 1
          ? "on"
          : "off"
        : "";
    if (!state) {
      state =
        device.device_params.open_close_state !== undefined
          ? device.device_params.open_close_state === 1
            ? "open"
            : "closed"
          : "";
    }
    return state;
  }

  async getDeviceStatePID(deviceMac, deviceModel, pid) {
    const prop = await this.getDevicePID(deviceMac, deviceModel);
    for (const property of prop.data.property_list) {
      if (pid == property.pid) {
        return property.value !== undefined
          ? property.value === "1"
            ? 1
            : 0
          : "";
      }
    }
  }

  getLockDoorState(deviceState) {
    if (deviceState >= 2) {
      return 1;
    } else {
      return deviceState;
    }
  }
  getLeakSensorState(deviceState) {
    if (deviceState >= 2) {
      return 1;
    } else {
      return deviceState;
    }
  }
  getLockState(deviceState) {
    if (deviceState == 2) {
      return 0;
    } else {
      return 1;
    }
  }
  checkBatteryVoltage(value) {
    if (value >= 100) {
      return 100;
    } else if (value == "undefined" || value == null) {
      return 1;
    } else {
      return value;
    }
  }
  rangeToFloat(value, min, max) {
    return (value - min) / (max - min);
  }
  floatToRange(value, min, max) {
    return Math.round(value * (max - min) + min);
  }
  kelvinToMired(value) {
    return Math.round(1000000 / value);
  }
  checkBrightnessValue(value) {
    if (value >= 1 || value <= 100) {
      return value;
    } else return value;
  }
  checkColorTemp(color) {
    if (color >= 500) {
      return 500;
    } else {
      return color;
    }
  }
  checkLowBattery(batteryVolts) {
    if (this.checkBatteryVoltage(batteryVolts) <= this.lowBatteryPercentage) {
      return 1;
    } else return 0;
  }

  fahrenheit2celsius(fahrenheit) {
    return (fahrenheit - 32.0) / 1.8;
  }
  celsius2fahrenheit(celsius) {
    return celsius * 1.8 + 32.0;
  }

  clamp(number, min, max) {
    return Math.max(min, Math.min(number, max));
  }

  sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
};
