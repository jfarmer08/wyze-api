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
