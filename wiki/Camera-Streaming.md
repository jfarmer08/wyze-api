# Camera Streaming

How to fetch live WebRTC stream credentials from a Wyze camera and use them in your application.

## Install

```bash
npm install wyze-api
```

That's it. The deps `werift` (pure-JS WebRTC), `ws` (WebSocket client), and `ffmpeg-static` (ffmpeg binary, used only by the snapshot capture path) come along automatically. **No system installs needed.**

## Quickstart — getting stream credentials

```js
const Wyze = require("wyze-api");

const wyze = new Wyze({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: "./",
});

await wyze.maybeLogin();

const camera = await wyze.getCameraByName("Front Porch");
const conn = await wyze.getCameraWebRTCConnectionInfo(camera.mac, camera.product_model);

// `conn` looks like:
// {
//   signalingUrl: "wss://m-XXXX.kinesisvideo.us-west-2.amazonaws.com/...",
//   iceServers: [
//     { urls: "turn:35-88-...:443", username: "...", credential: "..." },
//     { urls: "stun:stun.l.google.com:19302" },
//     ...
//   ],
//   authToken: "...",
//   clientId: "viewer-ccddeeff-1714137600000-a1b2c3d4",
//   mac: "AA:BB:CC:DD:EE:FF",
//   model: "WYZE_CAKP2JFUS",
//   substream: false,
//   cached: false,
// }
```

You hand `signalingUrl` + `iceServers` to a WebRTC client (browser, [werift](https://github.com/shinyoshiaki/werift-webrtc), [go2rtc](https://github.com/AlexxIT/go2rtc)) — this library does **not** stream video itself, only fetches the credentials a video stack needs.

> **Important**: pass the `signalingUrl` to your WebSocket **as-is**. Wyze pre-signs the URL with AWS SigV4; modifying any query parameter (including `X-Amz-ClientId`) will invalidate the signature and AWS will close the connection with code 1006.

## Method reference

### Lookup

| Method | Returns | Notes |
|---|---|---|
| `getCameras()` | `Camera[]` | filtered by `product_type === "Camera"` (case-insensitive) |
| `getOnlineCameras()` | `Camera[]` | only cameras whose `cameraIsOnline` is true |
| `getOfflineCameras()` | `Camera[]` | inverse of above |
| `getCamera(mac)` | `Camera \| undefined` | exact MAC match |
| `getCameraByName(nickname)` | `Camera \| undefined` | nickname match, case-insensitive |
| `getCameraSummaries()` | `Summary[]` | one summary per camera (see `cameraToSummary`) |

### Pure helpers (sync, take a device object)

| Method | Returns |
|---|---|
| `cameraIsOnline(device)` | `boolean` — checks `conn_state` → `device_params.status` → `is_online` in priority order |
| `cameraGetThumbnail(device)` | first thumbnail URL or `null` |
| `cameraGetSnapshot(device)` | first thumbnail object `{url, ts, type, ...}` or `null` |
| `cameraToSummary(device)` | `{mac, productModel, nickname, online, thumbnail}` |
| `cameraGetSignalStrength(device)` | Wi-Fi signal level or `null` |
| `cameraGetIp(device)` | local LAN IP or `null` |
| `cameraGetFirmware(device)` | firmware version string or `null` |
| `cameraGetTimezone(device)` | timezone name or `null` |
| `cameraGetLastSeen(device)` | `Date` or `null` |

### Stream credentials

| Method | Notes |
|---|---|
| `getCameraWebRTCConnectionInfo(mac, model, [options])` | **Primary entry point.** Bundle: `{signalingUrl, iceServers, authToken, clientId, mac, model, substream, cached}`. ICE servers normalized to `{urls, ...}` for `RTCPeerConnection`. |
| `getCameraWebRTCConnectionInfoWithReconnect(mac, model, [options], [retryOptions])` | Same, with exponential backoff retry. `retryOptions: {maxAttempts=3, baseDelayMs=2000, onRetry}`. |
| `cameraGetStreamInfo(mac, model, [options])` | Lower-level — returns the raw API shape `{signaling_url, ice_servers, auth_token, ...}`. |
| `cameraGetSignalingUrl(mac, model, [options])` | Just the URL string. |
| `cameraGetIceServers(mac, model, [options])` | Just the ICE list. |
| `clearCameraStreamCache([mac])` | Clear the in-memory cache (one camera or all). |
| `cameraStreamWithReconnect(fn, [retryOptions])` | Generic exponential-backoff wrapper for any stream call. |

### `getCameraWebRTCConnectionInfo` options

| Option | Default | Notes |
|---|---|---|
| `substream` | `false` | request lower-bitrate sub stream |
| `includeClientId` | `true` | generate (or accept) a client ID in the result |
| `clientId` | — | caller-supplied client ID (overrides generation) |
| `clientIdPrefix` | `"viewer"` | prefix when generating |
| `noCache` | `false` | bypass the in-memory cache |
| `cacheTtlMs` | `60_000` | cache TTL when caching is enabled |

## Caching

Connection info is cached per `(mac, model, substream)` for 60 seconds by default. Two consecutive calls for the same camera within that window share one API request:

```js
const a = await wyze.getCameraWebRTCConnectionInfo(mac, model);
console.log(a.cached); // false — fresh fetch
const b = await wyze.getCameraWebRTCConnectionInfo(mac, model);
console.log(b.cached); // true — served from cache
```

Pass `noCache: true` to bypass for one call, or `clearCameraStreamCache(mac)` to invalidate.

## Static exports

```js
const Wyze = require("wyze-api");
console.log(Wyze.StreamStatus);
// { OFFLINE: -90, STOPPING: -1, DISABLED: 0, STOPPED: 1, CONNECTING: 2, CONNECTED: 3 }
```

`StreamStatus` lifecycle constants mirror [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)'s stream states for cross-ecosystem compatibility.

## See also

- **[Snapshot Capture](Snapshot-Capture.md)** — fetching JPEG images (cloud or live capture)
- **[Browser Viewer Example](Browser-Viewer-Example.md)** — runnable end-to-end demo
- **[Troubleshooting](Troubleshooting.md)** — common errors
