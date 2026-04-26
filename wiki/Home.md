# wyze-api Wiki

Documentation for the camera-related features added in v1.1.10. Other parts of the library are documented in the project [README](../README.md).

## Pages

- **[Camera Streaming](Camera-Streaming.md)** — install, full method reference for camera lookup / WebRTC stream credentials / device-info accessors, code examples
- **[Snapshot Capture](Snapshot-Capture.md)** — cloud thumbnails + headless WebRTC frame capture (the cloud → live-capture fallback)
- **[Browser Viewer Example](Browser-Viewer-Example.md)** — running `example/viewer.js` to see your cameras live in a browser
- **[Troubleshooting](Troubleshooting.md)** — common errors and fixes (codec negotiation, WebSocket 1006, ffmpeg not found, offline cameras, rate limits)

## What this gives you

- **Live WebRTC streaming credentials** for any Wyze camera — signaling URL + ICE servers ready to drop into a `RTCPeerConnection`.
- **JPEG snapshots** with automatic fallback: try the cloud thumbnail first, capture from the live stream if unavailable.
- **Camera helpers** — sync accessors for online state, IP, signal strength, firmware, etc., plus async lookups by MAC or nickname.
- **All in `package.json`** — no system installs. The bundled `ffmpeg-static` provides the ffmpeg binary used for the snapshot capture path.

## Out of scope

- **TUTK protocol** (peer-to-peer direct camera streaming used by [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)) — requires native bindings and is a different transport. If you need a long-running bridge with multiple output formats (RTSP, HLS, MP4), use docker-wyze-bridge.
- **Persistent video relay** — this library hands you stream credentials and one-off frame captures. Continuous video relay is a separate concern; pair this with `go2rtc` or similar if you need an RTSP feed.
