# wyze-api
This is an unofficial Wyze API. This library uses the internal APIs from the Wyze mobile app. A list of all Wyze devices can be retrieved to check the status of Wyze Cameras, Wyze Sense, Wyze Bulbs, Wyze Plugs and possibly Wyze locks (untested). This API can turn on and off cameras, lightbulbs and smart plugs.

This is a work in progress and will have alot of updates in the future. 

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
  logging: "none"
}
const wyze = new Wyze(options, logger)

  ; (async () => {
    let device, state, result

    // Get all Wyze devices
    const devices = await wyze.getDeviceList()
    console.log(devices)

    // Get a Wyze Bulb by name and turn it off.
    device = await wyze.getDeviceByName('Porch Light')
    result = await wyze.turnOff(device)
    console.log(result)

    // Get the state of a Wyze Sense contact sensor
    device = await wyze.getDeviceByName('Front Door')
    state = await wyze.getDeviceState(device)
    console.log(`${device.nickname} is ${state}`)

  })()
```

## Run
`username=first.last@email.om password=123456 node index.js`

## Helper methods

Use this helper methods to interact with wyze-api.

- wyze.getDeviceList()
- wyze.getDeviceByName(nickname)
- wyze.getDeviceByMac(mac)
- wyze.getDevicesByType(type)
- wyze.getDevicesByModel(model)
- wyze.getDeviceGroupsList()
- wyze.getDeviceSortList()
- wyze.turnOn(device)
- wyze.turnOff(device)
- wyze.lock(device)
- wyze.unlock(device)
- wyze.getDeviceStatus(device)
- wyze.getDeviceState(device)



## Internal methods

- wyze.login()
- wyze.getRefreshToken()
- wyze.getObjectList()
- wyze.runAction(instanceId, providerKey, actionKey)
- wyze.getDeviceInfo(deviceMac, deviceModel)
- wyze.getPropertyList(deviceMac, deviceModel)
- wyze.setProperty(deviceMac, deviceModel, propertyId, propertyValue)
- wyze.controllock(deviceMac, deviceModel, action)
- wyze.getLockInfo(deviceMac, deviceModel)
- wyze.getIotProp(deviceMac, keys)
- wyze.setIotProp(deviceMac, product_model, propKey, value)
- wyze.getUserProfile()
- wyze.disableRemeAlarm(hms_id)
- wyze.getPlanBindingListByUser()
- wyze.monitoringProfileStateStatus(hms_id)
- wyze.monitoringProfileActive(hms_id, home, away)
- wyze.getPlanBindingListByUser()
- wyze.thermostatGetIotProp(deviceMac, keys)

## Other Info

Special thanks to the following projects for reference and inspiration:

- [ha-wyzeapi](https://github.com/JoshuaMulliken/ha-wyzeapi), a Wyze integration for Home Assistant.
- [wyze-node](https://github.com/noelportugal/wyze-node), a Node library for the Wyze API.
