# tests/docker — Tutk loader smoke tests

Validate the Phase 1 Tutk loader against the **real** `libIOTCAPIs_ALL.so`
inside a Linux container. Lets you exercise the binding layer from
macOS/Windows without needing a Pi or NAS.

## What this catches

- The `.so` actually opens via `koffi` (vs cryptic "wrong arch" /
  "missing dependency" errors that only show up at runtime)
- All 29 IOTC + AV function signatures in `src/tutk/loader.js`
  match the symbols exported from the `.so` (a missing symbol throws
  immediately at bind time)
- `IOTC_Initialize2` / `avInitialize` succeed end-to-end
- SDK lifecycle (init → deinit → re-init) is idempotent

What this does **not** catch: any code path that requires a real
camera — actual session establishment, IOCtrl mux delivery, video
frames. Those need a Wyze UID/enr and LAN connectivity from the
container (a separate test, TBD).

## Running

From the wyze-api repo root:

```bash
# Build + run for your host's architecture (Apple Silicon → arm64,
# Intel → amd64):
./tests/docker/run-tutk-smoke.sh

# Force a specific Linux arch (Rosetta on Apple Silicon, qemu on
# Intel — both supported by Docker Desktop):
./tests/docker/run-tutk-smoke.sh amd64
./tests/docker/run-tutk-smoke.sh arm64

# Run both sequentially (useful in CI):
./tests/docker/run-tutk-smoke.sh both
```

The first build downloads ~150 MB (Debian + Node + ~4 MB `.so`).
Subsequent runs reuse the cached image.

## Expected output

```
Tutk smoke test
  platform: linux-arm64
  node:     v20.x.x
  cwd:      /app

  loader module imports                                        ✓
  isTutkSupported() returns supported on Linux                 ✓ — linux-arm64
  defaultSoPath() resolves under HOME                          ✓ — ...
  koffi is installed                                           ✓ — koffi 3.x.x
  loadTutk() opens the .so                                     ✓ — libIOTCAPIs_ALL.so
  all 29 raw bindings registered                               ✓ — 29 symbols
  getVersionString() returns a non-empty string                ✓ — "4.2.x..."
  iotcInitialize2(0) returns 0                                 ✓
  avInitialize(8) returns 8 (max channels)                     ✓
  avDeInitialize() returns 0                                   ✓
  iotcDeInitialize() returns 0                                 ✓
  iotcInitialize2 succeeds again after deinit                  ✓
  iotcDeInitialize cleanup again                               ✓

✓ ALL 17 CHECKS PASSED
```

The SDK version string varies by architecture (Throughtek ships
arch-specific builds) — both `_Arm_*` and `_x64` are valid.

## When checks fail

| Failure | Likely cause |
|---|---|
| `loadTutk() opens the .so` ✗ — "Failed to dlopen" | wrong arch (use `--platform` to match), or `.so` corrupted (re-build image without cache: `docker build --no-cache ...`) |
| `all 29 raw bindings registered` ✗ — "missing: X, Y, Z" | docker-wyze-bridge updated to a newer SDK that removed/renamed symbols. Inspect `nm -D /root/.homebridge/wyze-sdk/libIOTCAPIs_ALL.so` inside the container; update `src/tutk/loader.js`. |
| `iotcInitialize2(0) returns 0` ✗ — returns negative | SDK couldn't initialize — usually a UDP port conflict or sandboxing issue. Check the value against [Throughtek IOTC error codes](https://github.com/mrlt8/docker-wyze-bridge/blob/main/app/wyzecam/tutk/tutk.py) (search for `IOTC_ER_*`). |

## Image internals

`Dockerfile.tutk-smoke`:

- Base: `debian:stable-slim` (glibc — the `.so` won't load on Alpine/musl)
- Node 20 LTS via NodeSource
- `npm install --omit=dev` for runtime deps only (koffi)
- Fetches the `.so` at build time via the standard
  `scripts/fetch-wyze-sdk.js` — same pinned-host + SHA256 path as the
  CLI

Built image is ~250 MB. Mostly Node + libc + the .so itself.

---

# Real-camera smoke test (`connect-real-camera.js`)

End-to-end validation against an actual Wyze camera on your LAN.
Builds on the loader smoke — same Docker image pattern, plus your
credentials piped in as env vars.

## What this proves

- The Phase 1 stack reaches a real camera over the LAN
- The IOTC session opens (camera UID + LAN routing both work)
- The AV channel starts on top of the IOTC session
- The auth handshake completes (xxtea, K10000/K10001/K10008/K10009)
- A K-class round-trip works (`K10090GetCameraTime` returns the
  camera's clock reading)
- `close()` cleans up without leaks

## Setup (one time)

```bash
cp tests/docker/.env.sample tests/docker/.env
$EDITOR tests/docker/.env
```

Fill in `WYZE_USERNAME`, `WYZE_PASSWORD`, `WYZE_KEY_ID`, `WYZE_API_KEY`.
Optionally set `WYZE_CAMERA_NICK` to target a specific camera; if
blank, the smoke uses the first online camera on the account.

`.env` is gitignored — your credentials never leave your machine.

## Run

```bash
./tests/docker/run-real-camera-smoke.sh
```

The container runs with `--network host` so it can reach Wyze
cameras on the LAN over UDP.

### ⚠️ Docker Desktop for Mac caveat

`--network host` on Docker Desktop for **Mac** (and Windows) joins
the *Docker VM's* internal network — **not** your Mac's LAN. This
means:

- Outbound cloud HTTPS works (the VM has internet)
- Camera UDP P2P **does not** — the VM can't see your cameras

You'll see the smoke get as far as `Tutk SDK version: ...` and then
hit the connect timeout (~25s) with `IOTC_Connect_ByUID timed out`.
This is expected and not a bug in the code — it's a Docker-on-Mac
networking limitation.

To actually validate end-to-end, run from a Linux host that's on the
same LAN as your cameras:

  - Raspberry Pi 4/5 (arm64)
  - x86_64 NAS or server running Docker Engine (not Desktop)
  - WSL 2 on Windows with mirrored networking enabled
  - The user's homebridge box, once it's running 2.0

On those hosts, `--network host` works as expected and the camera
session opens. The macOS Docker run still validates ~80% of the code
path (auth, device list, SDK load, all bindings, IOTC call attempted)
— just not the actual LAN handshake.

## Expected output (success)

```
--- Wyze cloud — login + device list ---
  devices on account            <N>
  cameras                       <M>
  online cameras                <K>
  chosen                        <Your Camera Name> (WYZE_CAKP2JFUS)
  mac                           AABBCCDDEEFF
  p2p_id                        ABC12345…WXYZ (32 chars)
  enr length                    16 chars
  LAN ip (if known)             192.168.x.y

--- Tutk session — connect → send K10090 → close ---
    [info] Tutk SDK version: 4.2.1.1-0-g537b3af_openssl_Arm_MR813_6.4.1
    [info] IOTC session 0 established to ABC12345…
    [info] AV channel 0 started (server_type=...)
    [info] Auth OK: {"connectionRes":"1","cameraInfo":{...}}
  connect()                     ✓ in 1234ms — state=authed
  send K10090                   ✓ in 89ms — camera time = 1719000000 (skew 0s)
  close()                       ✓ in 12ms — state=closed

--- Summary ---
  total elapsed                 1456ms
  result                        ✓ ALL GOOD — Phase 1 talks to real Wyze hardware end-to-end
```

## Common failure modes

| Failure | Likely cause |
|---|---|
| `login / device list failed` | bad credentials, MFA required, or Wyze cloud unreachable |
| `connect() ✗ ... TutkSessionError: IOTC_Connect_ByUID returned -19` | IOTC_ER_INVALID_ARG — usually wrong p2p_id format. Dump the device blob to check. |
| `connect() ✗ ... returned -10` | IOTC_ER_TIMEOUT — couldn't reach Throughtek's master servers (firewall?) OR the camera. Try without `--network host` to test cloud-only path; if cloud works, it's a LAN/UDP issue. |
| `connect() ✗ ... returned -22` | wrong enr — verify the `enr` value matches what Wyze cloud returned |
| `Auth OK` log line shows JSON with `connectionRes` ≠ `"1"` | camera rejected our auth — check enr, or the camera is in update mode |
| `send K10090 ✗ Timed out` | session got opened but the camera isn't responding to control messages — could be `avRecvIOCtrl` polling too slow, or the camera's overloaded |
| Hangs at `connect()` for >30s | NAT punching failed; camera unreachable over LAN. Confirm camera IP is reachable from your Docker VM (`docker run --rm --network host alpine ping -c 3 192.168.x.y`) |

## What this does NOT do

- Stream video. That's the AV frame path (`avRecvFrameData2` etc.) —
  not exercised here. Phase 2 work.
- Send any persistent change to the camera. K10090 is a read-only
  "what time is it?" query.
- Modify state, take snapshots, or otherwise have any side effect.

You can hit Ctrl-C any time; the session closes cleanly on SIGTERM
(no half-open IOTC sessions left dangling).

