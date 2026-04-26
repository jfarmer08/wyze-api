# Troubleshooting

Camera scope only. Other library issues are covered in the project [README](../README.md).

## All cameras show as offline

The lib's `cameraIsOnline` checks three fields in priority order: `device.conn_state` → `device.device_params.status` → `device.is_online`. If your Wyze account returns online state in a field this lib doesn't know about, fix it by:

1. Hitting `GET http://localhost:3030/api/debug/devices` (with the [browser viewer](Browser-Viewer-Example.md) running) to dump raw device JSON.
2. Look at one camera you know is online and find which field is set.
3. Open an issue with the field name + value.

## WebSocket close 1006 immediately after connect

You're modifying the signed signaling URL. Wyze pre-signs with AWS SigV4, and changing any query parameter (especially `X-Amz-ClientId`) invalidates the signature.

**Fix:** pass `signalingUrl` to `new WebSocket(...)` exactly as returned. Don't append, don't replace, don't decode further. The lib does NOT modify the URL by default — make sure your code isn't doing it either.

## "negotiate codecs failed" during snapshot capture

werift's default codec list doesn't include H.264, but Wyze cameras only stream H.264. The lib pins H.264 baseline 3.1 (`profile-level-id=42001f`) explicitly inside `cameraStreamCapture.js`. If you see this error, you're either:

- On a stale install — re-run `npm install` and check that `werift` resolves to ≥0.20.
- Using `cameraGetStreamInfo` directly with your own `RTCPeerConnection` setup (browser code) — make sure your transceiver advertises H.264. The browser does this automatically; werift in Node does not.

## "ffmpeg binary not found"

`ffmpeg-static` failed to download the binary during `npm install`. This usually means:

- **Unsupported platform** (e.g., uncommon ARM variant). Install ffmpeg via your OS package manager (`brew install ffmpeg`, `apt install ffmpeg`) and the lib will fall back to system `ffmpeg`.
- **Network issue during install** — try `npm install --force` or delete `node_modules` and reinstall.

The error message includes the exact path the lib tried.

## "Camera is offline" thrown from `cameraGetStreamInfo`

Two distinct failure modes:

1. **Top-level `code === "3019"`** — the Wyze API itself reports the camera as offline. This usually means the camera lost its Wi-Fi connection or is unplugged. The Wyze app will show the same.
2. **`iot-device::iot-state !== 1` in the response** — the camera responded but isn't ready to stream. Power-cycling the camera (or toggling its switch in the Wyze app) usually fixes this.

## Snapshot capture times out at 20 seconds

The most common cause is the camera not sending a keyframe quickly enough. werift waits for the first decodable frame; if the camera's keyframe interval is large or the connection is bad, this can exceed 20s.

**Try:**

- Increase the timeout: `wyze.cameraCaptureSnapshot(mac, model, {timeoutMs: 40_000})`.
- Use `substream: true` for a lower-bitrate stream that often delivers a keyframe faster.
- Verify the camera streams successfully in the [browser viewer](Browser-Viewer-Example.md) — if the browser can't stream it either, it's a camera-side problem.

## Access token / "Wyze access token error"

The lib will detect a `code === 2001` response, automatically clear and refresh the token, then throw with a "retry the call" message. **Catch the error and retry once** — the next call will use the fresh token:

```js
async function withRetry(fn) {
  try { return await fn(); }
  catch (err) {
    if (/access token error/i.test(err.message)) return fn();
    throw err;
  }
}
const conn = await withRetry(() => wyze.getCameraWebRTCConnectionInfo(mac, model));
```

Or use the built-in retry wrapper:

```js
const conn = await wyze.getCameraWebRTCConnectionInfoWithReconnect(mac, model);
```

## Rate limiting

`cameraGetStreamInfo` reads the `X-RateLimit-Remaining` header on every response. If it's below 7, the lib auto-sleeps until `X-RateLimit-Reset-By`. Below that, it throws "Wyze API rate limited (...)" — pause your loops and back off.

The 60-second cache on `getCameraWebRTCConnectionInfo` exists specifically to keep your rate-limit budget healthy under reconnect storms; don't bypass it (`noCache: true`) without a reason.

## Stream works for a few seconds then drops

Almost always an ICE/network issue, not the lib:

- TURN credentials in the response are short-lived. If you stash them and use them later, they expire. Always fetch fresh credentials immediately before opening the connection.
- Behind double NAT / strict firewalls, UDP-based ICE can fail. The lib returns the TURN servers Wyze provides, which use TCP-relay-on-443 as a fallback — that's usually the path that works on restrictive networks.

## Diagnostic logging

Pass `apiLogEnabled: true` in the constructor:

```js
const wyze = new Wyze({ ..., apiLogEnabled: true });
```

Stream-related calls will log:
- `[capture] track received kind=video codec=H264`
- `[capture] applied SDP_ANSWER`
- `[capture] captured 28341 bytes`

Plus the regular API request/response bodies for debugging the Wyze REST flow.
