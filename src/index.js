const axios = require('axios')
const fs = require('fs').promises
const path = require('path')
const getUuid = require('uuid-by-string')

const payloadFactory = require('./payloadFactory')
const crypto = require('./crypto')
const constants = require('./constants')
const util = require('./util')

module.exports = class WyzeAPI {
  constructor (options, log) {
    this.log = log
    this.persistPath = options.persistPath
    this.refreshTokenTimerEnabled = options.refreshTokenTimerEnabled || false
    // User login parameters
    this.username = options.username
    this.password = options.password
    this.mfaCode = options.mfaCode
    this.apiKey = options.apiKey
    this.keyId = options.keyId

    // Logging
    this.logging = options.logging

    // URLs
    this.authBaseUrl = options.authBaseUrl || constants.authBaseUrl
    this.apiBaseUrl = options.apiBaseUrl || options.baseUrl || constants.apiBaseUrl

    // App emulation constants
    this.authApiKey = options.authApiKey || constants.authApiKey
    this.phoneId = options.phoneId || constants.phoneId
    this.appName = options.appName || constants.appName
    this.appVer = options.appVer || constants.appVer
    this.appVersion = options.appVersion || constants.appVersion
    this.userAgent = options.userAgent || constants.userAgent
    this.sc = options.sc || constants.sc
    this.sv = options.sv || constants.sv

    // Crypto Secrets
    this.fordAppKey = options.fordAppKey || constants.fordAppKey // Required for Locks
    this.fordAppSecret = options.fordAppSecret || constants.fordAppSecret // Required for Locks
    this.oliveSigningSecret = options.oliveSigningSecret || constants.oliveSigningSecret // Required for the thermostat
    this.oliveAppId = options.oliveAppId || constants.oliveAppId //  Required for the thermostat
    this.appInfo = options.appInfo || constants.appInfo // Required for the thermostat

    // Login tokens
    this.access_token = ''
    this.refresh_token = ''

    this.dumpData = false // Set this to true to log the Wyze object data blob one time at startup.
    
    // Token is good for 216,000 seconds (60 hours) but 48 hours seems like a reasonable refresh interval 172800
    if (this.refreshTokenTimerEnabled === true){
      setInterval(this.refreshToken.bind(this), 172800)
    }
  }

  getRequestData (data = {}) {
    return {
      'access_token': this.access_token,
      'app_name': this.appName,
      'app_ver': this.appVer,
      'app_version': this.appVersion,
      'phone_id': this.phoneId,
      'phone_system_type': '1',
      'sc': this.sc,
      'sv': this.sv,
      'ts': (new Date).getTime(),
      ...data,
    }
  }

  async request (url, data = {}) {
    await this.maybeLogin()

    try {
      return await this._performRequest(url, this.getRequestData(data))
    } catch (e) {
      this.log.error(e)
      if (this.refresh_token) {
        this.log.error('Error, refreshing access token and trying again')

        try {
          await this.refreshToken()
          return await this._performRequest(url, this.getRequestData(data))
        } catch (e) {
          //
        }
      }

      this.log.error('Error, logging in and trying again')

      await this.login()
      return this._performRequest(url, this.getRequestData(data))
    }
  }

  async _performRequest (url, data = {}, config = {}) {
    config = {
      method: 'POST',
      url,
      data,
      baseURL: this.apiBaseUrl,
      ...config
    }

    if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
    if(this.logging == "debug") this.log.info(`Request config: ${JSON.stringify(config)}`)

    let result

    try {
      result = await axios(config)
      if(this.logging == "debug") this.log.info(`API response PerformRequest: ${JSON.stringify(result.data)}`)
      if (this.dumpData) {
        if(this.logging == "debug") this.log.info(`API response PerformRequest: ${JSON.stringify(result.data)}`)
        this.dumpData = false // Only want to do this once at start-up
      }
    } catch (e) {
      this.log.error(`Request failed: ${e}`)
      if (e.response) {
        this.log.error(`Response PerformRequest (${e.response.statusText}): ${JSON.stringify(e.response.data)}`)
      }

      throw e
    }
    if (result.data.msg) {
      throw new Error(result.data.msg)
    }

    return result
  }

  _performLoginRequest(data = {}) {
    let url = 'user/login'
    data = {
      email: this.username,
      password: util.createPassword(this.password),
      ...data
    }

    const config = {
      baseURL: this.authBaseUrl,
      headers: { 'x-api-key': this.authApiKey, 'User-Agent': this.userAgent }
    }

    if (this.apiKey && this.keyId) {
      url = 'api/user/login'
      console.log("Farmer APIKey and KEYID")
      config.headers = { 'apikey': this.apiKey, 'keyid': this.keyId, 'User-Agent': this.userAgent };
    }

    return this._performRequest(url, data, config)
  }

  async login () {
    let result = await this._performLoginRequest()

    // Do we need to perform a 2-factor login?
    if (!result.data.access_token && result.data.mfa_details) {
      if (!this.mfaCode) {
        throw new Error('Your account has 2-factor auth enabled. Please provide the "mfaCode" parameter in config.json.')
      }

      const data = {
        mfa_type: 'TotpVerificationCode',
        verification_id: result.data.mfa_details.totp_apps[0].app_id,
        verification_code: this.mfaCode
      }

      result = await this._performLoginRequest(data)
    }

    await this._updateTokens(result.data)

    if(this.logging == "debug") this.log.info('Successfully logged into Wyze API')
  }

  async maybeLogin () {
    if (!this.access_token) {
      await this._loadPersistedTokens()
    }

    if (!this.access_token) {
      await this.login()
    }
  }

  async refreshToken () {
    const data = {
      ...this.getRequestData(),
      refresh_token: this.refresh_token
    }

    const result = await this._performRequest('app/user/refresh_token', data)

    await this._updateTokens(result.data.data)
  }

  async _updateTokens ({ access_token, refresh_token }) {
    this.access_token = access_token
    this.refresh_token = refresh_token
    await this._persistTokens()
  }

  _tokenPersistPath () {
   // const uuid = 'test'
    const uuid = getUuid(this.username)
    return path.join(this.persistPath, `wyze-${uuid}.json`)
  }

  async _persistTokens () {
    const data = {
      access_token: this.access_token,
      refresh_token: this.refresh_token
    }
    this.log.info(this._tokenPersistPath())
    await fs.writeFile(this._tokenPersistPath(), JSON.stringify(data))
  }

  async _loadPersistedTokens () {
    try {
      let data = await fs.readFile(this._tokenPersistPath())
      data = JSON.parse(data)
      this.access_token = data.access_token
      this.refresh_token = data.refresh_token
    } catch (e) {
      //
    }
  }

  async getObjectList () {
    const result = await this.request('app/v2/home_page/get_object_list')

    return result.data
  }

  async getPropertyList (deviceMac, deviceModel) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel
    }

    const result = await this.request('app/v2/device/get_property_list', data)

    return result.data
  }

  async setProperty (deviceMac, deviceModel, propertyId, propertyValue) {
    const data = {
      device_mac: deviceMac,
      device_model: deviceModel,
      pid: propertyId,
      pvalue: propertyValue
    }

    const result = await this.request('app/v2/device/set_property', data)
    return result.data
  }

  async runAction (deviceMac, deviceModel, actionKey) {

    const data = {
      instance_id: deviceMac,
      provider_key: deviceModel,
      action_key: actionKey,
      action_params: {},
      custom_string: ''
    }
    console.log(data)
    if(this.logging == "debug") this.log.info(`run_action Data Body: ${JSON.stringify(data)}`)

    const result = await this.request('app/v2/auto/run_action', data)

    return result.data
  }

  async runActionList (deviceMac, deviceModel, propertyId, propertyValue, actionKey) {
    const plist = [
      {
        pid: propertyId,
        pvalue: String(propertyValue)
      }
    ]
    if (propertyId !== 'P3') {
      plist.push({
        pid: 'P3',
        pvalue: '1'
      })
    }
    const innerList = [
      {
        mac: deviceMac,
        plist
      }
    ]
    const actionParams = {
      list: innerList
    }
    const actionList = [
      {
        instance_id: deviceMac,
        action_params: actionParams,
        provider_key: deviceModel,
        action_key: actionKey
      }
    ]
    const data = {
      action_list: actionList
    }
    if(this.logging == "debug") this.log.info(`run_action_list Data Body: ${JSON.stringify(data)}`)

    const result = await this.request('app/v2/auto/run_action_list', data)

    return result.data
  }

  async controlLock (deviceMac, deviceModel, action) {
    await this.maybeLogin()
    var path = '/openapi/lock/v1/control'
    
    var payload = {
      "uuid": this.getUuid(deviceMac, deviceModel),
      "action": action  // "remoteLock" or "remoteUnlock"
  }

    let result

    try {
      payload = payloadFactory.fordCreatePayload(this.access_token, payload, path, "post")

      var urlPath = 'https://yd-saas-toc.wyzecam.com/openapi/lock/v1/control'
      result = await axios.post(urlPath, payload)
      if(this.logging == "debug") this.log(`API response ControLock: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log(`Response ControLock (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async getLockInfo(deviceMac, deviceModel) {
    await this.maybeLogin()

    let result
    let url_path = "/openapi/lock/v1/info"

    let payload = {
      "uuid": this.getUuid(deviceMac, deviceModel),
      "with_keypad": '1'
  }
    try {      
      let config = {
        params: payload
      }  
      payload = payloadFactory.fordCreatePayload(this.access_token, payload, url_path, "get")

      const url = 'https://yd-saas-toc.wyzecam.com/openapi/lock/v1/info'
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log(`API response GetLockInfo: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)
      if (e.response) {
        if(this.logging == "debug") this.log(`Response GetLockInfo (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async getIotProp(deviceMac, keys) {
    await this.maybeLogin()
    let result
    let payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    var signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': this.userAgent,
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.access_token,
        'signature2': signature
      },
      params: payload
    }
    try {
      var url = 'https://wyze-sirius-service.wyzecam.com/plugin/sirius/get_iot_prop'
      if(this.logging == "debug") this.log(`Performing request: ${url}`)
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log(`API response GetIotProp: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log(`Response GetIotProp (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async setIotProp(deviceMac, product_model, propKey, value) {
    await this.maybeLogin()
    let result
    let payload = payloadFactory.oliveCreatePostPayload(deviceMac, product_model, propKey, value);
    let signature = crypto.oliveCreateSignatureSingle(JSON.stringify(payload), this.access_token);

      const config = {
        headers: {
          'Accept-Encoding': 'gzip',
          'Content-Type': 'application/json',
          'User-Agent': 'myapp',
          'appid': constants.oliveAppId,
          'appinfo': constants.appInfo,
          'phoneid': this.phoneId,
          'access_token': this.access_token,
          'signature2': signature
        }
      }

    try {
      const url = 'https://wyze-sirius-service.wyzecam.com/plugin/sirius/set_iot_prop_by_topic'
      result = await axios.post(url, JSON.stringify(payload), config)
      if(this.logging == "debug") this.log(`API response SetIotProp: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log(`Response SetIotProp (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async getUserProfile() {
    await this.maybeLogin()

    let payload = payloadFactory.oliveCreateUserInfoPayload();
    let signature = crypto.oliveCreateSignature(payload, this.access_token);

    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'myapp',
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.access_token,
        'signature2': signature

      },
      params: payload
    }
    try {
      var url = 'https://wyze-platform-service.wyzecam.com/app/v2/platform/get_user_profile';
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log.info(`API response GetUserProfile: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response GetUserProfile (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async disableRemeAlarm(hms_id) {
    await this.maybeLogin()
    let result
    let config = {
      headers: {
        'Authorization': this.access_token,
        'User-Agent': this.userAgent,
      },
      data: {
        'hms_id': hms_id,
        'remediation_id': 'emergency'
      }
    }
    try {
      const url = 'https://hms.api.wyze.com/api/v1/reme-alarm';
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.delete(url, config)
      if(this.logging == "debug") this.log.info(`API response DisableRemeAlarm: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)
      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response DisableRemeAlarm (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async getPlanBindingListByUser() {
    await this.maybeLogin()
    let result
    let payload = payloadFactory.oliveCreateHmsPayload()
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': this.userAgent,
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.access_token,
        'signature2': signature
      },
      params: payload
    }

    try {
      const url = 'https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user';
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log.info(`API response GetPlanBindingListByUser: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response GetPlanBindingListByUser (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async monitoringProfileStateStatus(hms_id) {
    await this.maybeLogin()
    let result
    let query = payloadFactory.oliveCreateHmsGetPayload(hms_id);
    let signature = crypto.oliveCreateSignature(query, this.access_token);

    let config = {
      headers: {
        'User-Agent': this.userAgent,
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.access_token,
        'signature2': signature,
        'Authorization': this.access_token,
        'Content-Type': 'application/json'
      },
      params: query
    }

    try {
      const url = 'https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status'
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log.info(`API response MonitoringProfileStateStatus: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response MonitoringProfileStateStatus (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async monitoringProfileActive(hms_id, home, away) {
    await this.maybeLogin()
    let result
    const payload = payloadFactory.oliveCreateHmsPatchPayload(hms_id);
    const signature = crypto.oliveCreateSignature(payload, this.access_token)
    
    const config = {
      headers: {
        'User-Agent': this.userAgent,
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': constants.phoneId,
        'access_token': this.access_token,
        'signature2': signature,
        'Authorization': this.access_token 
      },
      params: payload
    }
    
    const data =  [
        {
            "state": "home",
            "active": home
        },
        {
            "state": "away",
            "active": away
        }
     ]
    
    try {
      const url = "https://hms.api.wyze.com/api/v1/monitoring/v1/profile/active";
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.patch(url, data, config)
      if(this.logging == "debug") this.log.info(`API response MonitoringProfileActive: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response MonitoringProfileActive (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async thermostatGetIotProp(deviceMac, keys) {
    await this.maybeLogin()
    let result
    let payload = payloadFactory.oliveCreateGetPayload(deviceMac, keys);
    let signature = crypto.oliveCreateSignature(payload, this.access_token);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': this.userAgent,
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': constants.phoneId,
        'access_token': this.access_token,
        'signature2': signature
      },
      params: payload
    }
    try {
      let url = 'https://wyze-earth-service.wyzecam.com/plugin/earth/get_iot_prop'
      if(this.logging == "debug") this.log.info(`Performing request: ${url}`)
      result = await axios.get(url, config)
      if(this.logging == "debug") this.log.info(`API response ThermostatGetIotProp: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response ThermostatGetIotProp (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async thermostatSetIotProp(deviceMac,deviceModel, propKey, value) {
    await this.maybeLogin()
    let result
    let payload = payloadFactory.oliveCreatePostPayload(deviceMac, deviceModel, propKey, value);
    let signature = crypto.oliveCreateSignatureSingle(JSON.stringify(payload), this.access_token)
    const config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
        'User-Agent': 'myapp',
        'appid': constants.oliveAppId,
        'appinfo': constants.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.access_token,
        'signature2': signature
      }
    }
    
    try {
      const url = 'https://wyze-earth-service.wyzecam.com/plugin/earth/set_iot_prop_by_topic';
      result = await axios.post(url, JSON.stringify(payload), config)
      if(this.logging == "debug") this.log.info(`API response ThermostatSetIotProp: ${JSON.stringify(result.data)}`)
    } catch (e) {
      this.log.error(`Request failed: ${e}`)

      if (e.response) {
        if(this.logging == "debug") this.log.info(`Response ThermostatSetIotProp (${e.response.statusText}): ${JSON.stringify(e.response.data, null, '\t')}`)
      }
      throw e
    }
    return result.data
  }

  async localBulbCommand(bulb, plist) {
    const characteristics = {
      mac: bulb.mac.toUpperCase(),
      index: "1",
      ts: String(Math.floor(Date.now() / 1000000)),
      plist: plist
    }
  
    const characteristics_str = JSON.stringify(characteristics)
    const characteristics_enc = util.wyzeEncrypt(bulb.enr, characteristics_str)
  
    const payload = {
      request: "set_status",
      isSendQueue: 0,
      characteristics: characteristics_enc
    }
  
    const payload_str = JSON.stringify(payload).replace("\\\\", "\\")
  
    const url = `http://${bulb.ip}:88/device_request`
  
    try {
      const response = await fetch(url, {
        method: "POST",
        body: payload_str
      })
      console.log(await response.text())
    } catch (error) {
      console.warning(
        `Failed to connect to bulb ${bulb.mac}, reverting to cloud.`
      )
      await this.runActionList(bulb, plist)
      bulb.cloud_fallback = true
    }
  }
  
  /**
  * Helper functions
  */

  getUuid (deviceMac, deviceModel) { return deviceMac.replace(`${deviceModel}.`, '')}

  async getObjects(){
    const result = await this.getObjectList()
    return result
  }

  async getDeviceList() {
    const result = await this.getObjectList()
    return result.data.device_list
  }

  async getDeviceByName(nickname) {
    const result = await this.getDeviceList()
    const device = result.find(device => device.nickname.toLowerCase() === nickname.toLowerCase())
    return device
  }

  async getDeviceByMac(mac) {
    const result = await this.getDeviceList()
    const device = result.find(device => device.mac === mac)
    return device
  }

  async getDevicesByType(type) {
    const result = await this.getDeviceList()
    const devices = result.filter(device => device.product_type.toLowerCase() === type.toLowerCase())
    return devices
  }

  async getDevicesByModel(model) {
    const result = await this.getDeviceList()
    const devices = result.filter(device => device.product_model.toLowerCase() === model.toLowerCase())
    return devices
  }

  async getDeviceGroupsList() {
    const result = await this.getObjectList()
    return result.data.device_group_list
  }

  async getDeviceSortList() {
    const result = await this.getObjectList()
    return result.data.device_sort_list
  }
  
  async getDevicePID(deviceMac, deviceModel)  { return await this.getPropertyList(deviceMac,deviceModel)}
  
  async cameraTurnOn(deviceMac,deviceModel) { return await this.runAction(deviceMac, deviceModel, 'power_on')}
  async cameraTurnOff(deviceMac,deviceModel) { return await this.runAction(deviceMac, deviceModel, 'power_off')}

  async garageDoor(deviceMac,deviceModel) { return await this.runAction(deviceMac, deviceModel, 'garage_door_trigger')}

  async cameraSirenOn(deviceMac, deviceModel) { await this.runAction(deviceMac, deviceModel, 'siren_on')}
  async cameraSirenOff(deviceMac, deviceModel) { await this.runAction(deviceMac, deviceModel, 'siren_off')}

  async turnMeshOn(device) { return await this.runActionList(device.mac, device.product_model ,'P3' , '1','set_mesh_property')}
  async turnMeshOff(device) { return await this.runActionList(device.mac, device.product_model ,'P3' , '0','set_mesh_property')}

  async unlockLock(device) { return await this.controlLock(device.mac, device.product_model, 'remoteUnlock')}
  async lockLock(device) { return await this.controlLock(device.mac, device.product_model, 'remoteLock')}

  async lockInfo(device) { return await this.getLockInfo(device.mac, device.product_model)}

  async getDeviceStatus(device) { return device.device_params}

  async cameraFloodLightOn(deviceMac, deviceModel) { await this.setProperty(deviceMac, deviceModel, "P1056", "1")} //on or open works for Spotlight
  async cameraFloodLightOff(deviceMac, deviceModel) { await this.setProperty(deviceMac, deviceModel, "P1056", "2")} //off or closed works for SpotLight

  async cameraMotionOn(deviceMac, deviceModel) {await this.setProperty(deviceMac, deviceModel, "P1001",1)}
  async cameraMotionOff(deviceMac, deviceModel) {await this.setProperty(deviceMac, deviceModel, "P1001",0)}
  
  async cameraSoundNotificationOn(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, "P1048", '1')}
  async cameraSoundNotificationOn(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, "P1048", '0')}

  async cameraAllNotificationsOn(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, 'P1','1')}
  async cameraAllNotificationsOn(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, 'P1','0')}

  async cameraMotionRecordingOn(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, 'P1047','1')}
  async cameraMotionRecordingOff(deviceMac, deviceModel){await this.setProperty(deviceMac, deviceModel, 'P1047','0')}

  //WyzeLight
  async lightTurnOn(deviceMac, deviceModel) { await this.setProperty(deviceMac, deviceModel, "P3", "0")}
  async lightTurnOff(deviceMac, deviceModel) { await this.setProperty(deviceMac, deviceModel, "P3", "1")}
  async lightSetBrightness(deviceMac, deviceModel, value) { await this.setProperty(deviceMac, deviceModel, "P1501", value)}
  async setColorTemperature(deviceMac, deviceModel, value) { await this.setProperty(deviceMac, deviceModel, "P1502", value)}

   // Wall Switch
  async wallSwitchPowerOn(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'switch-power', true)
    return response
  }
  async wallSwitchPowerOff(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'switch-power', false)
    return response
  }

  async wallSwitchIotOn(deviceMac, deviceModel, value) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'switch-iot', true)
    return response
  }
  async wallSwitchIotOff(deviceMac, deviceModel, value) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'switch-iot', false)
    return response
  }

  async wallSwitchLedStateOn(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'led_state', true)
    return response
  }

  async wallSwitchLedStateOff(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'led_state', false)
    return response
  }

  async wallSwitchVacationModeOn(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'vacation_mode', 0)
    return response
  }

  async wallSwitchVacationModeOff(deviceMac, deviceModel) {
    const response = await this.setIotProp(deviceMac, deviceModel, 'vacation_mode', 1)
    return response
  }
  /**
  * getDeviceState
  */
  async getDeviceState(device) {
    let state = device.device_params.power_switch !== undefined ? (device.device_params.power_switch === 1 ? 'on' : 'off') : ''
    if (!state) {
      state = device.device_params.open_close_state !== undefined ? (device.device_params.open_close_state === 1 ? 'open' : 'closed') : ''
    }
    return state
  }
}
