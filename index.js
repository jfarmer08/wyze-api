'use strict'
const axios = require('axios')
const md5 = require('md5')
const moment = require('moment')
const fs = require('fs').promises
const path = require('path')

const LocalStorage = require('node-localstorage').LocalStorage
const localStorage = new LocalStorage('./scratch')

const WyzeConstants = require('./constants')
const WyzeCrypto = require('./crypto')
const wyzeCrypto = new WyzeCrypto('./crypto')
const WyzePayloadFactory = require('./payloadFactory')
const wyzeConstants = new WyzeConstants('./constants')
const wyzePayloadFactory = new WyzePayloadFactory('./payloadFactory')


class Wyze {
  /**
   * @param {object} options
   * @constructor
   */
  constructor(options) {
    // User login parameters
    this.username = options.username
    this.password = options.password
    this.mfaCode = options.mfaCode

    // URLs
    this.authBaseUrl = options.authBaseUrl || wyzeConstants.AUTH_BASE_URL
    this.apiBaseUrl = options.apiBaseUrl || options.baseUrl || wyzeConstants.API_BASE_URL

    // App emulation constants
    this.authApiKey = options.authApiKey || wyzeConstants.AUTH_API_KEY
    this.phoneId = options.phoneId || wyzeConstants.PHONEID
    this.appName = options.appName || wyzeConstants.APPNAME
    this.appVer = options.appVer || wyzeConstants.APPVER
    this.appVersion = options.appVersion || wyzeConstants.appVersion
    this.appInfo = wyzeConstants.APPINFO
    this.userAgent = options.userAgent || wyzeConstants.USERAGENT

    // Login tokens
    this.accessToken = ''
    this.refreshToken = ''

    this.dumpData = false // Set this to true to log the Wyze object data blob one time at startup.
  }

  /**
   * get request data
   */
  async getRequestData(data = {}) {
    return {
      access_token: this.accessToken,
      phone_id: this.phoneId,
      app_ver: this.appVer,
      app_name: this.appName,
      app_version: this.appVersion,
      phone_system_type: '1',
      sc: wyzeConstants.SC,
      sv: wyzeConstants.SV,
      ts: (new Date).getTime(),
      ...data,
    }
  }

  /**
   * get tokens
   */
  async getTokens() {
    this.accessToken = localStorage.getItem('access_token')
    this.refreshToken = localStorage.getItem('refresh_token')
  }

  /**
   * set tokens
   */
  async setTokens(accessToken, refreshToken) {
    localStorage.setItem('access_token', accessToken)
    localStorage.setItem('refresh_token', refreshToken)
    this.accessToken = accessToken
    this.refreshToken = refreshToken
  }

  /**
   * login to get access_token
   * @returns {data}
   */
  async login() {
    let result
    try {

      const data = {
        email: this.username,
        password: md5(md5(md5((this.password)))),
      }

      let options = {
        headers: {
          'x-api-key': this.authApiKey,
          'user-agent': this.userAgent,
          'phone-id': this.phoneId,
        }
      }

      result = await axios.post(`${this.authBaseUrl}${wyzeConstants.WYZE_USER_LOGIN}`, await this.getRequestData(data), await options)
      this.setTokens(result.data['access_token'], result.data['refresh_token'])
    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * get refresh_token
   * @returns {data}
   */
  async getRefreshToken() {
    let result
    try {
      const data = {
        refresh_token: this.refreshToken,
      }
      result = await axios.post(wyzeConstants.API_BASE_URL + wyzeConstants.WYZE_REFRESH_TOKEN, await this.getRequestData(data))
      this.setTokens(result.data.data['access_token'], result.data.data['refresh_token'])
    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * get objects list
   * @returns {data}
   */
  async getObjectList() {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }
      result = await axios.post(wyzeConstants.API_BASE_URL + wyzeConstants.WYZE_GET_OBJECT_LIST, await this.getRequestData())
      if (result.data.msg === 'AccessTokenError') {
        await this.getRefreshToken()
        return this.getObjectList()
      }
    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * get device info
   * @returns {data.data}
   */
  async getDeviceInfo(deviceMac, deviceModel) {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }
      const data = {
        device_mac: deviceMac,
        device_model: deviceModel,
      }
      result = await axios.post(wyzeConstants.API_BASE_URL + wyzeConstants.WYZE_GET_DEVICE_INFO, await this.getRequestData(data))
    } catch (e) {
      throw e
    }
    return result.data.data
  }

  /**
   * get property
   * @returns {data.property_list}
   */
  async getPropertyList(deviceMac, deviceModel) {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }
      const data = {
        device_mac: deviceMac,
        device_model: deviceModel,
      }
      result = await axios.post(`${this.baseUrl}/app/v2/device/get_property_list`, await this.getRequestData(data))
    } catch (e) {
      throw e
    }
    return result.data.data.property_list
  }

  /**
   * set property
   * @returns {data}
   */
  async setProperty(deviceMac, deviceModel, propertyId, propertyValue) {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }
      const data = {
        device_mac: deviceMac,
        device_model: deviceModel,
        pid: propertyId,
        pvalue: propertyValue,
      }
      result = await axios.post(`${this.baseUrl}/app/v2/device/set_property`, await this.getRequestData(data))

    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * run action
   * @returns {data}
   */
  async runAction(instanceId, providerKey, actionKey) {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }

      const data = {
        provider_key: providerKey,
        instance_id: instanceId,
        action_key: actionKey,
        action_params: {},
        custom_string: '',
      }

      result = await axios.post(wyzeConstants.API_BASE_URL + wyzeConstants.WYZE_RUN_ACTION, await this.getRequestData(data))

      if (result.data.msg === 'AccessTokenError') {
        await this.getRefreshToken()
        return this.runAction(instanceId, actionKey)
      }
    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * run action list
   * @device = Dict of device
   * @propertyId = From Device Prop
   * @propertyValue = From Device Prop
   * @actionKey = power_on - power-off
   * @returns {data}
   */
  async runActionList(mac, product_model, propertyId, propertyValue, actionKey) {
    let result
    try {
      await this.getTokens();
      if (!this.accessToken) {
        await this.login()
      }

      const plist = [{
        pid: propertyId,
        pvalue: String(propertyValue)
      }]
      if (propertyId !== 'P3') {
        plist.push({
          pid: 'P3',
          pvalue: '1'
        })
      }
      const innerList = [{
        mac: mac,
        plist
      }]
      const actionParams = {
        list: innerList
      }
      const actionList = [{
        instance_id: mac,
        action_params: actionParams,
        provider_key: product_model,
        action_key: actionKey
      }]
      const data = {
        action_list: actionList
      }

      result = await axios.post(wyzeConstants.API_BASE_URL + wyzeConstants.WYZE_RUN_ACTION_LIST, await this.getRequestData(data))

      if (result.data.msg === 'AccessTokenError') {
        await this.getRefreshToken()
        return this.runAction(instanceId, actionKey)
      }
    } catch (e) {
      throw e
    }
    return result.data
  }

  /**
   * control lock
   * @returns {data}
   */
  async controllock(deviceMac, deviceModel, action) {
    let result
    const path = '/openapi/lock/v1/control'
    try {
      let body = {}
      body["action"] = action
      body["uuid"] = this.getLockUuid(deviceMac, deviceModel)


      var payload = wyzePayloadFactory.ford_create_payload(this.accessToken, body, path, "post")

      const url = wyzeConstants.LOCK_BASE_URL + wyzeConstants.LOCK_CONTROL_URL
      
      result = await axios.post(url, payload)

    } catch (e) {
      throw e
    }
    return result.data
  }
  // Does not work
  async getLockInfo(deviceMac, deviceModel) {
    let result
    try {
      let body = {
        "uuid": this.getLockUuid(deviceMac, deviceModel),
        "with_keypad": '1'
      }

      var payload = wyzePayloadFactory.ford_create_payload(this.accessToken, body, wyzeConstants.LOCK_INFO_URL, "get")

      result = await axios.get(wyzeConstants.LOCK_BASE_URL + wyzeConstants.LOCK_INFO_URL, payload)

    } catch (e) {
      throw e
    }
    return result.data;
  }
  async getUserProfile() {
    var payload = wyzePayloadFactory.olive_create_user_info_payload();
    var signature = wyzeCrypto.olive_create_signature_single(payload, this.accessToken);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'myapp',
        'appid': wyzeConstants.OLIVE_APP_ID,
        'appinfo': wyzeConstants.APPINFO,
        'phoneid': wyzeConstants.PHONEID,
        'access_token': this.accessToken,
        'signature2': signature

      },
      payload: {
        'nonce': payload.nonce
      }
    }
    var url = 'https://wyze-platform-service.wyzecam.com/app/v2/platform/get_user_profile';

    const response_json = await axios.get(url, config);

    return response_json.data.data;
  }

  async disableRemeAlarm(hms_id) {
    /*
    Wraps the hms.api.wyze.com/api/v1/reme-alarm endpoint

    :param hms_id: The hms_id for the account
      */

    url = 'https://hms.api.wyze.com/api/v1/reme-alarm';
    let config = {
      headers: {
        'Authorization': self._auth_lib.token.access_token
      },
      payload: {
        'hms_id': hms_id,
        'remediation_id': 'emergency'
      }
    }
    response_json = await axios.delete(url, headers = headers, json = payload);
    return response_json.data
  }

  async getPlanBindingListByUser() {
    /*
    Wraps the wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user endpoint

    :return: The response to gathering the plan for the current user
     */
    ;

    var url = 'https://wyze-membership-service.wyzecam.com/platform/v2/membership/get_plan_binding_list_by_user';
    var payload = wyzePayloadFactory.olive_create_hms_payload()
    var signature = wyzeCrypto.olive_create_signature(payload, this.accessToken);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'myapp',
        'appid': wyzeConstants.OLIVE_APP_ID,
        'appinfo': wyzeConstants.APPINFO,
        'phoneid': wyzeConstants.PHONEID,
        'access_token': this.accessToken,
        'signature2': signature
      },
      params: {
        'group_id': payload.group_id,
        'nonce': payload.nonce
      }
    }
    var response_json = await axios.get(url, config);
    return response_json.data;
  }

  async monitoringProfileStateStatus(hms_id) {
    /*
    Wraps the hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status endpoint

    :param hms_id: The hms_id
    :return: The response that includes the status
      */

    var url = 'https://hms.api.wyze.com/api/v1/monitoring/v1/profile/state-status';
    var query = wyzePayloadFactory.olive_create_hms_get_payload(hms_id);
    var signature = wyzeCrypto.olive_create_signature(query, this.accessToken);


    let config = {
      headers: {
        'User-Agent': 'myapp',
        'appid': wyzeConstants.OLIVE_APP_ID,
        'appinfo': wyzeConstants.APPINFO,
        'phoneid': wyzeConstants.PHONEID,
        'access_token': this.accessToken,
        'signature2': signature,
        'Authorization': this.accessToken,
        'Content-Type': 'application/json'
      },
      params: query
    }

    try {

      var response_json = await axios.get(url, config);

      return response_json.data;
    } catch (e) {
      throw e
    }


  }

  async thermostatGetIotProp(device) {

    var payload = wyzePayloadFactory.olive_create_get_payload(device.mac);
    var signature = wyzeCrypto.olive_create_signature(payload, this.accessToken);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'myapp',
        'appid': wyzeConstants.OLIVE_APP_ID,
        'appinfo': this.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.accessToken,
        'signature2': signature
      },
      payload: payload
    }


    var url = 'https://wyze-earth-service.wyzecam.com/plugin/earth/get_iot_prop';

    response_json = await axios.get(url, config);

    return response_json;
  }

  async thermostatSetIotProp(Device, ThermostatProps) {

    var url = 'https://wyze-earth-service.wyzecam.com/plugin/earth/set_iot_prop_by_topic';
    var payload = olive_create_post_payload(device.mac, device.product_model, prop, value);
    var signature = olive_create_signature(json.dumps(payload, separators = (',', ':')),
      self._auth_lib.token.access_token);
    let config = {
      headers: {
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
        'User-Agent': 'myapp',
        'appid': wyzeConstants.OLIVE_APP_ID,
        'appinfo': this.appInfo,
        'phoneid': this.phoneId,
        'access_token': this.accessToken,
        'signature2': signature
      },
      params: payload_str = json.dumps(payload, separators = (',', ':'))
    }
    var response_json = await axios.post(url, config);
    return response_json
  }

  /**
   * Helper functions
   */
  /**
   * getDeviceList
   */
  getLockUuid(deviceMac, deviceModel) {
    return deviceMac.replace(`${deviceModel}.`, '')
  }
  async getObjects() {
    const result = await this.getObjectList()
    return result
  }
  /**
   * getDeviceList
   */
  async getDeviceList() {
    const result = await this.getObjectList()
    return result.data.device_list
  }

  /**
   * getDeviceByName
   */
  async getDeviceByName(nickname) {
    const result = await this.getDeviceList()
    const device = result.find(device => device.nickname.toLowerCase() === nickname.toLowerCase())
    return device
  }

  /**
   * getDeviceByMac
   */
  async getDeviceByMac(mac) {
    const result = await this.getDeviceList()
    const device = result.find(device => device.mac === mac)
    return device
  }

  /**
   * getDevicesByType
   */
  async getDevicesByType(type) {
    const result = await this.getDeviceList()
    const devices = result.filter(device => device.product_type.toLowerCase() === type.toLowerCase())
    return devices
  }

  /**
   * getDevicesByModel
   */
  async getDevicesByModel(model) {
    const result = await this.getDeviceList()
    const devices = result.filter(device => device.product_model.toLowerCase() === model.toLowerCase())
    return devices
  }

  /**
   * getDeviceGroupsList
   */
  async getDeviceGroupsList() {
    const result = await this.getObjectList()
    return result.data.device_group_list
  }

  /**
   * getDeviceSortList
   */
  async getDeviceSortList() {
    const result = await this.getObjectList()
    return result.data.device_sort_list
  }


  /**
   * turnOn
   */
  async turnOn(device) {
    return await this.runAction(device.mac, device.product_model, 'power_on')
  }

  /**
   * turnOff
   */
  async turnOff(device) {
    return await this.runAction(device.mac, device.product_model, 'power_off')
  }
  /**
   * turnOn
   */
  async turnMeshOn(device) {
    return await this.runActionList(device.mac, device.product_model, 'P3', '1', 'set_mesh_property')
  }

  /**
   * turnOff
   */
  async turnMeshOff(device) {
    return await this.runActionList(device.mac, device.product_model, 'P3', '0', 'set_mesh_property')
  }
  /**
   * unlock Lock
   */
  async unlock(device) {
    return await this.controllock(device.mac, device.product_model, 'remoteUnlock')
  }
  /**
   * lock Lock
   */
  async lock(device) {
    return await this.controllock(device.mac, device.product_model, 'remoteLock')
  }
  /**
   * lock Lock
   */
  async lockInfo(device) {
    return await this.getLockInfo(device.mac, device.product_model)
  }

  /**
   * getDeviceStatus
   */
  async getDeviceStatus(device) {
    return device.device_params
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
module.exports = Wyze