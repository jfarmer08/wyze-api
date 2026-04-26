# Snapshot Capture

Two paths exist for getting a JPEG of a Wyze camera:

1. **Cloud thumbnail** — Wyze stores periodic snapshots; the device list includes the URL. Free, instant, but the cloud doesn't always have one (newly online camera, low-traffic camera, sometimes stale).
2. **Live WebRTC capture** — negotiate a one-shot WebRTC session, grab a single H.264 frame, decode to JPEG via ffmpeg, tear down. Always works for online cameras, but takes 3–5 seconds and requires more resources.

`getCameraSnapshotImage(mac, options)` does the right thing automatically: tries cloud, falls back to capture.

## What's needed

Just `npm install`. The `ffmpeg-static` npm package ships the ffmpeg binary for your platform — no system install. Supported platforms: macOS x64/arm64, Linux x64/arm/arm64, Windows x64.

## Methods

| Method | Returns | Notes |
|---|---|---|
| `getCameraSnapshot(mac)` | `{url, ts, ...} \| null` | cloud thumbnail metadata only |
| `getCameraSnapshotUrl(mac)` | `string \| null` | just the cloud URL |
| `cameraCaptureSnapshot(mac, model, [options])` | `Buffer` (JPEG) | live WebRTC capture, no cloud check |
| `getCameraSnapshotImage(mac, [options])` | `{buffer, source}` | **Primary**: tries cloud, falls back to capture |

### `getCameraSnapshotImage(mac, options)`

```js
const { buffer, source } = await wyze.getCameraSnapshotImage(mac);
// source === "cloud" — got it from a cached cloud thumbnail
// source === "capture" — fell back to a live WebRTC capture

await fs.promises.writeFile(`${mac}.jpg`, buffer);
```

Options:

| Option | Default | Notes |
|---|---|---|
| `skipCloud` | `false` | go straight to live capture |
| `timeoutMs` | `20_000` | overall timeout for the capture path |
| `noCache` | `false` | bypass the per-mac capture cache |
| `cacheTtlMs` | `10_000` | capture-cache TTL |

### `cameraCaptureSnapshot(mac, model, options)` directly

```js
const buffer = await wyze.cameraCaptureSnapshot(mac, model);
// Buffer of JPEG bytes
```

The capture is cached per-mac for 10 seconds — rapid repeat calls share one capture. Useful when multiple consumers (e.g., several HomeKit accessories) ask for the same camera within seconds.

## How the live capture works

```
┌──────────────┐      ┌─────────┐      ┌──────────────┐      ┌────────┐
│ Wyze REST    │ ──>  │ werift  │ ──>  │ UDP socket   │ ──>  │ ffmpeg │ ──> JPEG
│ /get-streams │      │ (WebRTC │      │ (RTP relay)  │      │ (H.264 │
│              │      │  recv)  │      │              │      │  → JPG)│
└──────────────┘      └─────────┘      └──────────────┘      └────────┘
```

1. Fetch fresh stream credentials via `getCameraWebRTCConnectionInfo` (no cache; we want a fresh signed URL).
2. werift opens a `RTCPeerConnection` configured for **H.264 baseline 3.1** (the profile every Wyze cam supports — werift's default codec list excludes H.264 explicitly, so we pin it).
3. Open a WebSocket to the Kinesis Video signaling URL, exchange SDP offer/answer + ICE candidates using Wyze's envelope format (same one `viewer.html` uses).
4. Each H.264 RTP packet werift receives is forwarded over UDP to a local port that ffmpeg is listening on (driven by a temp SDP file).
5. ffmpeg decodes one frame, encodes to JPEG, writes to stdout. We capture stdout, return the buffer.
6. Tear down: WebSocket close, peer connection close, UDP socket close, ffmpeg kill, temp file unlink.

Code: [src/cameraStreamCapture.js](../src/cameraStreamCapture.js).

## When to use which

- **HomeKit / Home Assistant snapshot** — `getCameraSnapshotImage(mac)`. Fast when cloud has one, robust fallback when not.
- **You always want the live frame** — `cameraCaptureSnapshot(mac, model)` or `getCameraSnapshotImage(mac, {skipCloud: true})`.
- **You only want metadata** (URL, timestamp) without downloading bytes — `getCameraSnapshot(mac)`.

## Troubleshooting

See **[Troubleshooting](Troubleshooting.md)** for snapshot-specific errors (ffmpeg not found, codec negotiation, timeouts).
