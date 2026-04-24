# wyze-api

## Releases
### v1.1.9
- Add IoT3 API support for Lock Bolt V2 (DX_LB2) and Palm lock (DX_PVLOC): `iot3GetProperties`, `iot3RunAction`, `lockBoltV2GetProperties`, `lockBoltV2Lock`, `lockBoltV2Unlock`
- Add `palm-state` to `getIotProp` property keys

### v1.1.8
- Add irrigation/sprinkler support: `irrigationGetIotProp`, `irrigationGetDeviceInfo`, `irrigationGetZones`, `irrigationQuickRun`, `irrigationStop`, `irrigationGetScheduleRuns`

### v1.1.7
- Change Logging

### v1.1.6
- Refactor Wyze Auth & Core Api Fetching https://github.com/jfarmer08/wyze-api/pull/12
- Fix turnOn/turnOff methods for plugs and lights https://github.com/jfarmer08/wyze-api/pull/14

### v1.1.5
- Adds check if code is not in the message

### v1.1.4
- Adds a check, log message, and refresh atttempt if the code of the response does not equal 1

### v1.1.3
- Clean Login api
- Add debounce for login api

### v1.1.2
- Change user aganet based on package version

### v1.1.1
- Chnage user agent to unofficial-wyze-api/1.0

### v0.1.1.0
- First Release
