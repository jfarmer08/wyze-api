'use strict'
const axios = require('axios')
const md5 = require('md5')
const moment = require('moment')
const fs = require('fs').promises
const path = require('path')

const LocalStorage = require('node-localstorage').LocalStorage
const localStorage = new LocalStorage('./scratch')

const WyzeConstants = require('./constants')
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
    }
    catch (e) {
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
    }
    catch (e) {
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
    }
    catch (e) {
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
  }
  catch (e) {
    throw e
  }
  return result.data
}

  /**
   * control lock
   * @returns {data}
   */
   async controllock (deviceMac, deviceModel, action) {

    let body = {}
      body["action"] = action
      body["uuid"] = this.getLockUuid(deviceMac, deviceModel)

    var payload = wyzePayloadFactory.ford_create_payload(this.accessToken, body, wyzeConstants.LOCK_CONTROL_URL, "post")

    let result

    try {
      result = await axios.post(wyzeConstants.LOCK_BASE_URL + wyzeConstants.LOCK_CONTROL_URL, payload)
    } catch (e) {
          throw e
    }
    return result.data
  }


  
  /**
  * Helper functions
  */
 /**
  * getDeviceList
  */
   getLockUuid (deviceMac, deviceModel) {
    return deviceMac.replace(`${deviceModel}.`, '')
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

  async unlock(device) {
    return await this.controlLock(device.mac, device.product_model, 'remoteUnlock')
  }

  async lock(device) {
    return await this.controlLock(device.mac, device.product_model, 'remotelock')
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
