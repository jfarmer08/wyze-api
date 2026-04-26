# wyze-api

## Releases
### v1.1.11
- Add Wyze Robot Vacuum support (model `JA_RO2`) via the Venus service. Resolves [#4](https://github.com/jfarmer08/wyze-api/issues/4). Patterned after [shauntarves/wyze-sdk](https://github.com/shauntarves/wyze-sdk/blob/master/wyze_sdk/api/devices/vacuums.py).
- Venus auth/signing: new `venusGenerateDynamicSignature` and `venusRequestId` crypto helpers; new `venusBaseUrl`, `venusAppId`, `venusSigningSecret`, `vacuumModels`, `venusPluginVersion`, `vacuumFirmwareVersion`, `vacuumEventTrackingUuid` constants.
- Lookup: `getVacuumDeviceList`, `getVacuum(mac)`, `getVacuumInfo(mac)` (combined: list entry + iot props + device info + status + position + map; tolerant of partial sub-fetch failures).
- Reads: `getVacuumIotProp`, `getVacuumDeviceInfo`, `getVacuumStatus`, `getVacuumCurrentPosition`, `getVacuumCurrentMap`, `getVacuumMaps`, `getVacuumSweepRecords`.
- Controls (mac/model API): `vacuumControl` (low-level), `vacuumClean`, `vacuumPause`, `vacuumDock`, `vacuumStop`, `vacuumCancel`, `vacuumSweepRooms`, `vacuumSetSuctionLevel`, `setVacuumCurrentMap`.
- Device-object helpers (homebridge-style): `vacuumStartCleaning(device)`, `vacuumPauseCleaning(device)`, `vacuumReturnToDock(device)`, `vacuumCleanRooms(device, ids)`, `vacuumQuiet/Standard/Strong(device)`, `vacuumInfo(device)`.
- Pure info accessors: `vacuumGetBattery` (handles the Wyze `battary` typo), `vacuumGetMode`, `vacuumGetFault`, `vacuumIsCharging`, `vacuumIsCleaning`, `vacuumIsDocked`.
- Opt-in event tracking: `vacuumEventTracking(mac, type, value, args)` — mirrors the analytics ping the Wyze app sends. Not required for controls to take effect.
- Exports on `WyzeAPI`: `VacuumControlType`, `VacuumControlValue`, `VacuumStatus`, `VacuumSuctionLevel`, `VacuumPreferenceType`, `VacuumModeCodes`, `parseVacuumMode`, `VacuumFaultCode`, `VacuumIotPropKeys`, `VacuumDeviceInfoKeys`, `VenusDotArg1/2/3`, `VacuumControlTypeDescription`.
- New example: `example/vacuum.js` + `npm run vacuum` script.
- `src/types.js` now properly exports its constants (was previously dead code).

### v1.1.10
- Add camera WebRTC stream support. Port of [wyzeapy#230](https://github.com/SecKatie/wyzeapy/pull/230) plus production-ready helpers ported from the [`camera-stream`](https://github.com/jfarmer08/wyze-api/tree/camera-stream) reference branch.
- Primary: `getCameraWebRTCConnectionInfo(mac, model, options)` — returns `{signalingUrl, iceServers, authToken, clientId, mac, model, substream, cached}`. ICE servers are normalized to `{urls, ...}` for `RTCPeerConnection`; signaling URL is decoded and (optionally) has the generated client ID injected as `X-Amz-ClientId`. 60s in-memory cache per `(mac, substream)`.
- Convenience: `getCameraWebRTCConnectionInfoWithReconnect` (exponential-backoff retry), `cameraStreamWithReconnect` (general retry wrapper).
- Lower-level: `cameraGetStreamInfo`, `cameraGetSignalingUrl`, `cameraGetIceServers` — all accept `{substream}` option.
- Helpers: `createCameraStreamClientId`, `normalizeCameraSignalingUrl`, `setCameraSignalingClientId`, `sanitizeCameraIceServers`, `parseCameraStatus`, `clearCameraStreamCache`.
- `WyzeAPI.StreamStatus` lifecycle constants (numeric values mirror docker-wyze-bridge).
- Add `cameraCaptureSnapshot(mac, model, [options])` — headless WebRTC frame capture (negotiates a session, grabs one JPEG via ffmpeg, tears down). 10s per-mac cache. New deps: `werift`, `ws`, `ffmpeg-static` (bundled ffmpeg binary — no system install needed).
- Add `getCameraSnapshotImage(mac, [options])` — unified image getter; tries cloud thumbnail first, falls back to live capture. Returns `{buffer, source}`.
- Add camera lookup helpers: `getCameras`, `getOnlineCameras`, `getOfflineCameras`, `getCamera(mac)`, `getCameraByName(nickname)`, `getCameraSnapshot(mac)`, `getCameraSnapshotUrl(mac)`, `getCameraSummaries`.
- Add pure device-object helpers: `cameraIsOnline`, `cameraGetThumbnail`, `cameraGetSnapshot`, `cameraToSummary`, `cameraGetSignalStrength`, `cameraGetIp`, `cameraGetFirmware`, `cameraGetTimezone`, `cameraGetLastSeen`.
- Add `web_create_signature` crypto helper and `webAppId`/`webAppInfo`/`webSigningSecret` constants for the `app.wyze.com` web API.
- New example: `example/viewer.js` + `example/public/viewer.html` — a browser-based WebRTC viewer that exercises all the new camera helpers end-to-end.

### v1.1.9
- Add IoT3 API support for Lock Bolt V2 (DX_LB2) and Palm lock (DX_PVLOC)
- Add `lockBoltV2GetProperties`, `lockBoltV2Lock`, `lockBoltV2Unlock` for Bolt V2
- Add `palmLockGetProperties` for Palm lock
- Add `iot3GetProperties` and `iot3RunAction` as general IoT3 methods
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
