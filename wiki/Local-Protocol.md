# Local Protocol (Tutk + GUTES)

`wyze-api` ships a pure-JavaScript port of both Wyze local-LAN camera
protocols so cameras can eventually be controlled and streamed without
routing through Wyze's cloud HTTP API. This page tracks the status of
each phase and what's actually shipped.

This work is in progress. It does **not** yet replace any of the cloud
methods documented elsewhere in this wiki; those still work exactly as
documented. When the local path is wired in (Phase 2.5 below), it will
be opt-in via an `advanced.tutk.enabled` config flag and fall back to
the cloud HTTP API when local is unavailable.

## Why two protocols?

Wyze uses two different P2P stacks depending on the camera family:

- **Tutk / IOTC** — every camera the average user owns: V2, V3, V4,
  Pan v1/v2/v3, Outdoor / Outdoor 2, original Doorbell, OG, Battery
  Cam Pro, and the Robot Vacuum. Backed by Throughtek's IOTC SDK
  (`libIOTCAPIs_ALL.so`), which docker-wyze-bridge ships as ordinary
  glibc binaries for x86_64, arm64, and armv7.

- **GUTES** (Gwell) — Doorbell Pro family and some other Gwell-based
  devices. Backed by `libiotp2pav.so`, which Wyze extracts from the
  Wyze Android APK. It depends on Android's Bionic libc, so loading it
  on Linux needs a shim layer (the
  [cryze](https://github.com/carTloyal123/cryze) project solved this
  with `androdyne`).

## Tutk

| Phase | What | Status |
|---|---|---|
| **0**  | Pure-JS protocol layer (`src/tutk/lib/` — codec, header, all K-class messages 10000–12060, xxtea, auth). Byte-exact against the docker-wyze-bridge Python reference. | ✅ done |
| **1**  | `koffi` loader for `libIOTCAPIs_ALL.so` (`src/tutk/loader.js`) + Promise-based session/auth/IOCtrl mux (`src/tutk/session.js`). Uses koffi's `.async()` worker-pool variant for blocking SDK calls so timeouts actually fire. | ✅ done |
| **1.5**| Self-test harness without the `.so` (stub SDK) + Docker smoke test that loads the real `.so` (`tests/docker/`) + real-camera smoke (`tests/docker/connect-real-camera.js`). | ✅ done |
| **2**  | Worker-thread receive pump — move the 50 Hz `avRecvIOCtrl` poll off the main event loop so video streaming is viable without dropping frames. | ⏳ planned |
| **2.5**| Wire Tutk control into the homebridge bridge: route camera commands locally when Tutk is available, fall back to cloud HTTP otherwise. Opt-in via config. | ⏳ planned |
| **3**  | A/V transport — `avRecvFrameData2` → H.264 NALUs into a stream that HomeKit (or any other consumer) can attach to. | ⏳ planned |

Tutk runs on **Linux only**. macOS/Windows hosts will continue to use
the cloud HTTP path. The Phase 1 loader throws a clear
`TutkLoaderError` on unsupported platforms so callers can choose their
fallback.

### What's verified end-to-end as of Phase 1.5

- 188/188 unit tests pass on macOS arm64 + Linux x64
- Docker loader smoke (`tests/docker/run-tutk-smoke.sh`) — 17/17 checks
  pass on both arm64 and x64
- Real-camera smoke against a Wyze V3 on the LAN — Wyze cloud login,
  device list, `.so` load, IOTC session attempt all clean; UDP P2P
  NAT-punching from inside Docker Desktop on macOS hits the documented
  double-NAT limitation (see [Troubleshooting](Troubleshooting.md)).
  Running the same smoke under OrbStack or on a real Linux LAN host
  completes the round-trip.

## GUTES

| Phase | What | Status |
|---|---|---|
| **0** | Pure-JS protocol layer (`src/gutes/lib/` — RC5, frame parser, session crypto, KEEPALIVE builders, pcap reader). Byte-exact against the cryze Python reference. | ✅ done |
| **1** | `libiotp2pav.so` loading via `koffi` — blocked on writing a Bionic-to-glibc shim. The `.so` is yanked out of the Wyze APK and depends on Android's libc layout (`__system_property_get`, `__strchr_chk`, Bionic pthread layout, etc.). | ❌ not started |
| **2** | A/V transport (MTP_DATA reassembly into H.264 NALUs) — blocked on Phase 1. | ❌ not started |

The Tutk path covers every camera the average user owns *except* the
Doorbell Pro family, so GUTES is the lower-priority track. Phase 0
ships the parser/crypto layer so anyone who wants to take on the
Bionic shim has a verified protocol foundation to build on.

## Installing the `.so` files

```bash
# Both: tutk + gutes
npx wyze-api-fetch-wyze-sdk

# Just tutk (skip the gutes APK download)
npx wyze-api-fetch-wyze-sdk --type tutk

# Use a pre-downloaded XAPK from APKPure (gutes only)
npx wyze-api-fetch-wyze-sdk --type gutes --xapk /path/to/wyze.xapk
```

Files land in `~/.homebridge/wyze-sdk/` by default. See
[`scripts/README.md`](https://github.com/jfarmer08/wyze-api/blob/main/scripts/README.md)
in the repo for full options.

## Deep-dive READMEs

These live in the repo (not the wiki) because they're tightly coupled
to the source layout:

- **`src/tutk/README.md`** — loader + session details, lifecycle, thread model, error taxonomy
- **`src/gutes/README.md`** — protocol layer + Phase 1 wall (Bionic shim)
- **`example/tutk-spike/README.md`** — Tutk Phase 0 runnable demo + fixture tests
- **`example/gutes-spike/README.md`** — GUTES Phase 0 runnable demo + pcap reader
- **`tests/docker/README.md`** — Docker smoke harness, including the Docker Desktop on macOS UDP NAT caveat

## How this fits the bigger picture

```
  ┌──────────────────────────┐
  │  Today: wyze-api cloud   │  ← every method in this wiki uses these
  │  HTTPS endpoints         │
  └──────────────────────────┘
                │
                │  Phase 2.5 will add a fallback router that prefers
                │  the local path when it's healthy, falls back to
                │  cloud HTTP when it isn't:
                ▼
  ┌──────────────────────────┐
  │  src/tutk/session.js     │  Phase 1 (DONE) — runs the IOTC session
  │  src/tutk/loader.js      │  Phase 1 (DONE) — koffi → libIOTCAPIs_ALL.so
  └──────────────────────────┘
                │
                ▼
  ┌──────────────────────────┐
  │  Camera on LAN (V3 etc.) │
  └──────────────────────────┘
```

For the Doorbell Pro family the equivalent diagram would route through
`src/gutes/` instead — but Phase 1 there is gated on the Bionic shim
and is not yet started.
