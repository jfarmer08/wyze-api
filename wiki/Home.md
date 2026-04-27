# wyze-api Wiki

Full reference for [`wyze-api`](https://www.npmjs.com/package/wyze-api), an unofficial Node.js wrapper for the Wyze ecosystem. Method signatures and behaviors documented here track [src/index.js](../src/index.js) — file an issue if you spot drift.

## Start here

- **[Getting Started](Getting-Started.md)** — install, the minimum viable example, constructor options
- **[Authentication](Authentication.md)** — `keyId` / `apiKey`, MFA, token persistence, login debounce, refresh
- **[Device Lookup](Device-Lookup.md)** — `getDeviceList`, lookups by mac/name/type/model, generic state accessors

## Device families

- **[Cameras — Controls](Cameras.md)** — power, siren, flood/spotlight, motion, notifications, recording, garage door
- **[Cameras — Streaming](Camera-Streaming.md)** — WebRTC stream credentials (signaling URL, ICE servers)
- **[Cameras — Snapshot Capture](Snapshot-Capture.md)** — cloud thumbnails + headless live-capture fallback
- **[Browser Viewer Example](Browser-Viewer-Example.md)** — runnable in-browser WebRTC demo
- **[Plugs](Plugs.md)** — on/off
- **[Lights & Bulbs](Lights-and-Bulbs.md)** — direct + mesh, brightness, color temperature, hue/saturation
- **[Wall Switches](Wall-Switches.md)** — `LD_SS1` switch, classic vs IoT, vacation mode, LED state
- **[Locks](Locks.md)** — V1 lock control, Bolt V2, Palm lock (IoT3 API)
- **[Thermostat](Thermostat.md)** — read/write IoT props (mode, setpoints, fan, schedule)
- **[Irrigation / Sprinkler](Irrigation.md)** — zones, quick-run, stop, schedule history
- **[HMS — Home Monitoring System](HMS.md)** — alarm modes (off/home/away)
- **[Robot Vacuum](Robot-Vacuum.md)** — `JA_RO2` clean/pause/dock/cancel/rooms, suction level, maps, sweep records
- **[Sensors](Sensors.md)** — Wyze Sense contact (`DWS3U`/`DWS2U`) and motion (`PIR3U`/`PIR2U`) lookups + state accessors

## Reference

- **[Helpers](Helpers.md)** — battery / range / kelvin-mired / sleep / lock-state utilities
- **[API Reference](API-Reference.md)** — module exports (`StreamStatus`, `Vacuum*`, `VenusDot*`, etc.)
- **[Troubleshooting](Troubleshooting.md)** — common errors and fixes

## Out of scope

- **TUTK protocol** (peer-to-peer direct camera streaming used by [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)) — different transport, requires native bindings.
- **Persistent video relay** — this library hands you stream credentials and one-off frame captures. For continuous RTSP/HLS, pair with `go2rtc` or `docker-wyze-bridge`.
- **Wyze official cloud APIs** — there's no public Wyze API; everything here uses the same internal endpoints the mobile app uses.
