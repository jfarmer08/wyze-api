# wyze-api

## Releases
### v2.0.0-beta.1

First 2.0 beta. Available on npm only via `npm install wyze-api@beta`. Stable users on the default `latest` tag are unaffected. Pairs with `homebridge-wyze-smart-home@2.0.0-beta.1`.

48 commits since the last stable. Major reorganization, new device support, security hardening, full HomeKit camera streaming primitives, and a custom logger.

#### 🏗️ Major reorganization

The monolithic `index.js` was split into per-family modules:
- `src/devices/cameras.js`, `bulbs.js`, `locks.js`, `sensors.js`, `vacuum.js`, `irrigation.js`, `hms.js`, `thermostat.js`
- Each family has a companion `*.helpers.js` for device-object wrappers and pure accessors (the API used by homebridge accessory classes).
- Service primitives extracted to `src/services/` (`olive.js`, `ford.js`, `iot3.js`, `venus.js`, `devicemgmt.js`, `hms.js`).
- Crypto and payload signing moved to `src/utils/`.

The public surface (`require('wyze-api')`) is unchanged — every method that worked before still works, and many new ones now exist as named exports.

#### 🎥 HomeKit camera streaming primitives

Everything a HomeKit `CameraController` needs to drive Wyze cameras end-to-end:

- **`getCameraWebRTCConnectionInfo(mac, model, options)`** — returns `{signalingUrl, iceServers, authToken, clientId, mac, model, substream, cached}` with ICE servers normalized for `RTCPeerConnection`. 60s in-memory cache per `(mac, substream)`.
- **`getCameraWebRTCConnectionInfoWithReconnect`** + **`cameraStreamWithReconnect`** — exponential-backoff retry wrappers.
- **Lower-level**: `cameraGetStreamInfo`, `cameraGetSignalingUrl`, `cameraGetIceServers` (all accept `{substream}`).
- **`startRtpForwarding`** + **`cameraStartRtpForwarding`** — bridges a Wyze WebRTC session into a HAP-compatible SRTP stream.
- **`cameraCaptureSnapshot(mac, model, [options])`** — headless WebRTC capture: negotiates a session, grabs one JPEG via bundled ffmpeg, tears down. 10s per-mac cache.
- **`getCameraSnapshotImage(mac, [options])`** — unified getter; cloud thumbnail first, falls back to live capture. Returns `{buffer, source}`.
- **Camera lookup helpers**: `getCameras`, `getOnlineCameras`, `getOfflineCameras`, `getCamera(mac)`, `getCameraByName(nickname)`, `getCameraSnapshot(mac)`, `getCameraSnapshotUrl(mac)`, `getCameraSummaries`.
- **Pure device-object helpers**: `cameraIsOnline`, `cameraGetThumbnail`, `cameraGetSnapshot`, `cameraToSummary`, `cameraGetSignalStrength`, `cameraGetIp`, `cameraGetFirmware`, `cameraGetTimezone`, `cameraGetLastSeen`.
- **Audio**: Opus codec support end-to-end (16/24 kHz).
- **`StreamStatus`** lifecycle constants (numeric values mirror docker-wyze-bridge).
- **New deps**: `werift` (WebRTC), `ws` (signaling), `ffmpeg-static` (bundled binary, no system install).

#### 🎯 `shared/homekit.js` — single source of truth for converters

All Wyze ↔ HomeKit value conversions live in one module that bridges import directly:
- Color converters: `wyzeColorToHomeKit`, `homeKitColorToWyze`
- Brightness / color temperature with proper clamping (`checkBrightnessValue`, `checkColorTemp`, `kelvinToMired`, `miredToKelvin`)
- Temperature: `fahrenheitToCelsius`, `celsiusToFahrenheit`
- Garage door state mapping (`wyzeGarageDoorStateToHomeKit`)
- Vacuum: `parseVacuumMode`, `wyzeVacuumModeIsCleaning`, `wyzeVacuumSuctionToHomeKit`, `homeKitRotationSpeedToWyzeSuction`
- HMS state: `wyzeHmsStateToHomeKit`, `homeKitHmsStateToWyze`
- Wyze Room Sensor (CO_TH1) battery enum → HomeKit StatusLowBattery
- Lock Bolt V2 device helpers
- Battery: `checkLowBattery` (honors per-instance `lowBatteryPercentage`)

#### 📦 `WyzeAccessoryModels` — exported model maps

Shipping a frozen `WyzeAccessoryModels` object as the source of truth for product-code → device-class routing. Bridges import this and shallow-clone into per-category maps that can be extended at runtime via user config (`deviceTypeOverrides`). One place to add a new model code; all consumers pick it up.

Categories: `CameraModels`, `OutdoorPlugModels`, `PlugModels`, `LightModels`, `MeshLightModels`, `LightStripModels`, `ContactSensorModels`, `MotionSensorModels`, `LockModels`, `LockBoltV2Models`, `TemperatureHumidityModels`, `LeakSensorModels`, `CommonModels`, `S1GatewayModels`, `ThermostatModels`, `ThermostatRoomSensor`, `VacuumModels`, `IrrigationModels`.

#### 🔐 New `WyzeLogger`

`@ptkdev/logger` removed. New custom logger in `src/util/wyzeLogger.js`:
- Format matches Homebridge style (timestamp, cyan prefix, color-coded level tag).
- Constructor option `logLevel: "error" | "warn" | "info" | "debug"`. Legacy `apiLogEnabled: true` still works (maps to `debug`).
- New `redact: false` option to bypass log redaction for self-debugging.
- ANSI colors on by default (homebridge stdout isn't a TTY but handles ANSI fine).
- Honors `NO_COLOR` env var.

#### 🛡️ Security hardening consolidated

`src/util/redact.js` and `src/securityHardening.js` merged into `src/util/security.js`. Single module covers:
- Log redaction (bearer tokens, credentials, GPS, addresses, emails, MACs)
- Secrets-file loader (mode-600 enforcement, env-var fallback for every credential field)
- Base URL validator (HTTPS-only, no IP literals, no `.local` / `.localhost`)
- Hostname allowlist (auto-derived from `*BaseUrl` constants in `constants.js`)
- Axios redirect guard (refuses 3xx on Wyze hosts)
- Device-name sanitization for HomeKit (length + control chars)

All hardcoded URLs removed from `services/`, `devices/hms.js`, and `index.js`. Adding a new endpoint in `constants.js` automatically allowlists its hostname.

#### 🆕 New device support / parity

- **Wyze Robot Vacuum (`JA_RO2`)** via the Venus service: `getVacuumDeviceList`, `getVacuum`, `getVacuumInfo` (combined snapshot), `vacuumClean`, `vacuumPause`, `vacuumDock`, `vacuumStop`, `vacuumSweepRooms(mac, [roomId])`, `vacuumSetSuctionLevel`, plus device-object helpers and pure accessors (`vacuumGetMode`, `vacuumGetFault`, `vacuumIsCharging`, etc.).
- **`getVacuumRooms(mac)`** — current map's room list as plain JSON `[{ id, name, mapId, mapName }]`. Backs the bridge's per-room sweep switches.
- **Wyze Sprinkler Controller (`BS_WK1`)**: `irrigationGetIotProp`, `irrigationGetDeviceInfo`, `irrigationGetZones`, `irrigationQuickRun`, `irrigationStop`, `irrigationGetScheduleRuns`.
- **Wyze Lock Bolt V2 (`DX_LB2`)** + **Palm Lock (`DX_PVLOC`)** via IoT3 API: `lockBoltV2GetProperties`, `lockBoltV2Lock`, `lockBoltV2Unlock`, `palmLockGetProperties`, plus general `iot3GetProperties` / `iot3RunAction`.
- **Wyze Lock V1 full read parity** with wyze-sdk — exposes battery, door state, lock state, RSSI, all the metadata wyze-sdk reads.
- **DeviceMgmt API** for newer cameras (Floodlight Pro / Battery Cam Pro / OG cam) that don't respond to the standard `run_action`: `_deviceMgmtRunAction`, `_deviceMgmtSetToggle`, `_deviceMgmtBuildCapability`. Routes camera commands automatically based on model.
- **Light Strip Pro per-subsection colors** — 16-subsection HEX support; closes the rest of #42.
- **Music mode**, **bulb effects**, **mesh-bulb sun-match**, **push notification info**, **bulb local-or-cloud routing fallback** — large parity batch with wyzeapy.
- **Camera event list** (`getEventList`), **motion-detection bug fixes**, **enum supplements** for new product codes.

#### 🐛 Reliability fixes

- **Refresh-token failure falls back to fresh `login()`.** Wyze invalidates refresh tokens server-side faster than the documented TTL; the previous behavior left consumers broken until host process restart. Now: clear tokens, re-login transparently, single warn line.
- **`mkdir -p` token persist directory before write.** HOOBS doesn't pre-create its persist dir; the first write threw `ENOENT` and the consumer never recovered. (homebridge-wyze-smart-home#201, #236)
- **`wyzeColorToHomeKit` guards bad input.** Wyze occasionally returns `null` / `""` / non-hex for `PID_COLOR` during state transitions; the previous parse threw. Now returns neutral `{hue:0, saturation:0}` on bad input.
- **V1 lock signing fix** — Ford API `PARAM_SIGN_INVALID` resolved by augmenting payload before signing + using snake_case for GET, camelCase for POST.
- **Olive-signed call consolidation** — single source of truth for olive signature generation across earth/sirius/platform/membership/lockwood.
- **`getVacuumInfo`** always fetches position + map (was gated behind unused `includeMap` flag).

#### 🚀 Breaking

- **Logger replaced** (see above).
- **Security utilities consolidated** into `src/util/security.js`. Re-exports preserved for the public surface (`installRedirectGuard`, `sanitizeLogMessage`, `WYZE_ALLOWED_HOSTNAMES`) — most call sites unaffected.
- **All base URLs centralized** in `constants.js`. Allowlist auto-derives.
- **Unused dependencies removed**: `aws-sdk`, `base64-js`, `colorsys`, `crypto-js`, `moment`, `urllib`. Cleared the critical `crypto-js` PBKDF2 advisory and the `aws-sdk` → `ip` SSRF chain.
- `axios` floor bumped to `^1.12.0`.

#### 📚 Wiki

Full library documentation at https://github.com/jfarmer08/wyze-api/wiki — every module covered.

#### 🔍 Internal

- 178/178 tests pass.
- Production npm audit: 4 issues remain, all from the `werift` WebRTC chain (transitive `ip` SSRF + `uuid` bounds); no upstream fix available, deferred.
- Two GitHub Actions workflows: `npm-publish-stable.yml` and `npm-publish-beta.yml`.

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
