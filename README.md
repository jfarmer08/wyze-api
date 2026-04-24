# wyze-api
[![npm](https://img.shields.io/npm/dt/wyze-api)](https://www.npmjs.com/package/wyze-api)
[![npm](https://img.shields.io/npm/v/wyze-api.svg?style=flat-square)](https://www.npmjs.com/package/wyze-api)
[![Chat](https://img.shields.io/discord/1134601590762913863)](https://discord.gg/Mjkpq2x9)
[![GitHub last commit](https://img.shields.io/github/last-commit/jfarmer08/wyze-api)](https://github.com/jfarmer08/wyze-api)


# Funding   [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square&maxAge=2592000)](https://www.paypal.com/paypalme/AllenFarmer) [![Donate](https://img.shields.io/badge/Donate-Venmo-blue.svg?style=flat-square&maxAge=2592000)](https://venmo.com/u/Allen-Farmer) [![Donate](https://img.shields.io/badge/Donate-Cash_App-blue.svg?style=flat-square&maxAge=2592000)](https://cash.app/$Jfamer08)

This is an unofficial Wyze API. This library uses the internal APIs from the Wyze mobile app. A list of all Wyze devices can be retrieved to check the status of Cameras, Senors, Bulbs, Plugs, Locks and more. This API can turn on and off cameras, lightbulbs and plugs and more.

## Setup
`npm install wyze-api --save`

## Example
```
const Wyze = require('wyze-api')
const Logger = require("@ptkdev/logger")
const logger = new Logger()

const options = {
  username: process.env.username,
  password: process.env.password,
  keyId: process.env.keyId,
  apiKey: process.env.apiKey,
  persistPath: "./",
  logLevel: "none"
}
const wyze = new Wyze(options, logger)

  ; (async () => {
    let device, state, result

    // Get all Wyze devices
    const devices = await wyze.getDeviceList()
    console.log(devices)

    // Get a Wyze Bulb by name and turn it off.
    device = await wyze.getDeviceByName('Porch Light')
    result = await wyze.lightTurnOff(device.mac, device.product_model)
    console.log(result)

    // Get the state of a Wyze Sense contact sensor
    device = await wyze.getDeviceByName('Front Door')
    state = await wyze.getDeviceState(device)
    console.log(`${device.nickname} is ${state}`)

  })()
```

## Run
`username=first.last@email.om password=123456 keyId=2222222 apiKey=222222 node index.js`

## Helper methods

Use these helper methods to interact with wyze-api.

### Generic Device Methods
- wyze.getDeviceList()
- wyze.getDeviceByName(nickname)
- wyze.getDeviceByMac(mac)
- wyze.getDevicesByType(type)
- wyze.getDevicesByModel(model)
- wyze.getDeviceGroupsList()
- wyze.getDeviceSortList()
- wyze.getDeviceStatus(device)
- wyze.getDeviceState(device)
- wyze.getDevicePID(device.mac, device.product_model)
- wyze.getDeviceStatePID(device.mac, device.product_model, pid)

### Camera Methods
- wyze.cameraPrivacy(device.mac, device.product_model, value)
- wyze.cameraTurnOn(device.mac, device.product_model)
- wyze.cameraTurnOff(device.mac, device.product_model)
- wyze.cameraSiren(device.mac, device.product_model, value)
- wyze.cameraSirenOn(device.mac, device.product_model)
- wyze.cameraSirenOff(device.mac, device.product_model)
- wyze.cameraFloodLight(device.mac, device.product_model, value)
- wyze.cameraFloodLightOn(device.mac, device.product_model)
- wyze.cameraFloodLightOff(device.mac, device.product_model)
- wyze.cameraSpotLight(device.mac, device.product_model, value)
- wyze.cameraSpotLightOn(device.mac, device.product_model)
- wyze.cameraSpotLightOff(device.mac, device.product_model)
- wyze.cameraMotionOn(device.mac, device.product_model)
- wyze.cameraMotionOff(device.mac, device.product_model)
- wyze.cameraSoundNotificationOn(device.mac, device.product_model)
- wyze.cameraSoundNotificationOff(device.mac, device.product_model)
- wyze.cameraNotifications(device.mac, device.product_model, value)
- wyze.cameraNotificationsOn(device.mac, device.product_model)
- wyze.cameraNotificationsOff(device.mac, device.product_model)
- wyze.cameraMotionRecording(device.mac, device.product_model, value)
- wyze.cameraMotionRecordingOn(device.mac, device.product_model)
- wyze.cameraMotionRecordingOff(device.mac, device.product_model)

### Plug Methods
- wyze.plugPower(device.mac, device.product_model, value)
- wyze.plugTurnOn(device.mac, device.product_model)
- wyze.plugTurnOff(device.mac, device.product_model)

### Light Bulb Methods
- wyze.lightPower(device.mac, device.product_model, value)
- wyze.lightTurnOn(device.mac, device.product_model)
- wyze.lightTurnOff(device.mac, device.product_model)
- wyze.setBrightness(device.mac, device.product_model, value)
- wyze.setColorTemperature(device.mac, device.product_model, value)

### Mesh Light/Plug Methods
- wyze.turnMeshOn(device.mac, device.product_model)
- wyze.turnMeshOff(device.mac, device.product_model)
- wyze.lightMeshPower(device.mac, device.product_model, value)
- wyze.lightMeshOn(device.mac, device.product_model)
- wyze.lightMeshOff(device.mac, device.product_model)
- wyze.setMeshBrightness(device.mac, device.product_model, value)
- wyze.setMeshColorTemperature(device.mac, device.product_model, value)
- wyze.setMeshHue(device.mac, device.product_model, value)
- wyze.setMeshSaturation(device.mac, device.product_model, value)

### Wall Switch Methods
- wyze.wallSwitchPower(device.mac, device.product_model, value)
- wyze.wallSwitchPowerOn(device.mac, device.product_model)
- wyze.wallSwitchPowerOff(device.mac, device.product_model)
- wyze.wallSwitchIot(device.mac, device.product_model, value)
- wyze.wallSwitchIotOn(device.mac, device.product_model)
- wyze.wallSwitchIotOff(device.mac, device.product_model)
- wyze.wallSwitchLedStateOn(device.mac, device.product_model)
- wyze.wallSwitchLedStateOff(device.mac, device.product_model)
- wyze.wallSwitchVacationModeOn(device.mac, device.product_model)
- wyze.wallSwitchVacationModeOff(device.mac, device.product_model)

### Lock Methods
- wyze.lockLock(device)
- wyze.unlockLock(device)
- wyze.lockInfo(device)

### Garage Door Methods
- wyze.garageDoor(device.mac, device.product_model)

### Home Monitoring System (HMS) Methods
- wyze.getHmsID()
- wyze.setHMSState(hms_id, mode)
- wyze.getHmsUpdate(hms_id)

### Thermostat Methods
- wyze.thermostatGetIotProp(device.mac)
- wyze.thermostatSetIotProp(device.mac, device.product_model, propKey, value)
- wyze.thermostatGetIotProp(deviceMac, keys)

### Irrigation (Sprinker) Methods
- wyze.irrigationGetDeviceInfo(deviceMac)
- wyze.irrigationGetZones(deviceMac)
- wyze.irrigationQuickRun(deviceMac, zoneNumber, duration)
- wyze.irrigationStop(deviceMac)
- wyze.irrigationGetScheduleRuns(deviceMac)
- wyze.irrigationGetIotProp(deviceMac)

## Internal methods
- wyze.login()
- wyze.maybeLogin()
- wyze.refreshToken()
- wyze.getObjectList()
- wyze.getPropertyList(device.mac, device.product_model)
- wyze.setProperty(device.mac, device.product_model, propertyId, propertyValue)
- wyze.runAction(device.mac, device.product_model, actionKey)
- wyze.runActionList(device.mac, device.product_model, propertyId, propertyValue, actionKey)
- wyze.controlLock(device.mac, device.product_model, action)
- wyze.getLockInfo(device.mac, device.product_model)
- wyze.getIotProp(device.mac)
- wyze.setIotProp(device.mac, device.product_model, propKey, value)
- wyze.getUserProfile()
- wyze.disableRemeAlarm(hms_id)
- wyze.getPlanBindingListByUser()
- wyze.monitoringProfileStateStatus(hms_id)
- wyze.monitoringProfileActive(hms_id, home, away)
- wyze.getPlanBindingListByUser()

## Other Info

Special thanks to the following projects for reference and inspiration:

- [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), a Wyze integration for Home Assistant.
- [wyze-node](https://github.com/noelportugal/wyze-node), a Node library for the Wyze API.
- [wyzeapy](https://github.com/SecKatie/wyzeapy), a Python library for the Wyze API.
