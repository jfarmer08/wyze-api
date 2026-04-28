# wyze-api

## Releases
### v2.0.0-beta.1

First 2.0 beta. Available on npm only via `npm install wyze-api@beta`. Stable users on the default `latest` tag are unaffected. Pairs with `homebridge-wyze-smart-home@2.0.0-beta.1`.

#### Breaking
- **Logger replaced.** `@ptkdev/logger` removed; new `WyzeLogger` (in `src/util/wyzeLogger.js`) produces homebridge-styled output (timestamp, cyan prefix, color-coded level tag). Constructor option `logLevel: "error" | "warn" | "info" | "debug"` is now the canonical control. Legacy `apiLogEnabled: true` still works (maps to `debug`). New option `redact: false` to bypass log redaction for self-debugging — never share resulting logs.
- **Security utilities consolidated.** `src/util/redact.js` and `src/securityHardening.js` have been merged into `src/util/security.js`. Re-exports preserved where they were public (`installRedirectGuard`, `sanitizeLogMessage`, `WYZE_ALLOWED_HOSTNAMES`, etc.) — most call sites should be unaffected.
- **All base URLs centralized in `constants.js`.** Hardcoded URLs were removed from `services/`, `devices/hms.js`, and `index.js`. The redirect-guard hostname allowlist is now derived from any `*BaseUrl` constant — adding a new endpoint allowlists it for free.
- **Unused dependencies removed.** `aws-sdk`, `base64-js`, `colorsys`, `crypto-js`, `moment`, `urllib`. None of these were referenced in source. Cleared the critical `crypto-js` PBKDF2 advisory and the `aws-sdk` → `ip` SSRF chain.

#### Reliability fixes
- **Refresh-token failure now falls back to a fresh `login()`.** Wyze invalidates refresh tokens server-side faster than the documented TTL; the previous behavior left the plugin in a broken state until the host process restarted. Now: clear tokens, re-login with stored credentials, single warn line, normal operation resumes.
- **`mkdir -p` token persist directory before write.** HOOBS doesn't pre-create its persist dir like homebridge does, so the first write threw `ENOENT` and the plugin never recovered.
- **`wyzeColorToHomeKit` guards bad input.** Wyze occasionally returned `null` / `""` / non-hex for `PID_COLOR` during state transitions; the previous parse threw and (in some host configs) crashed the process. Now returns neutral `{hue:0, saturation:0}` on bad input — true color picked up on next refresh.

#### New
- **`getVacuumRooms(mac)`** — returns the current map's room list as plain JSON `[{ id, name, mapId, mapName }]`. Backs the new per-room sweep switches in the bridge.
- **`getVacuumInfo(mac)` always fetches position + map.** Was previously gated behind an `includeMap: true` flag that nobody passed. Each sub-fetch is still wrapped in `safe()` so a failing endpoint doesn't lose the rest.
- `axios` floor bumped to `^1.12.0` (clears SSRF / DoS / CSRF / mergeConfig `__proto__` advisories).

#### Internal
- 178/178 tests pass. Remaining production audit: 4 issues in the `werift` WebRTC chain (transitive `ip` + `uuid`); no upstream fix available, deferred.

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
