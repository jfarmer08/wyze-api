# wyze-api/scripts

Maintenance / setup scripts shipped with the wyze-api package.

## `fetch-wyze-sdk.js`

Downloads the Wyze SDK `.so` libraries needed for **local Tutk / GUTES
streaming** (Phase 1+ work — currently dev/research, not wired into
the published bridge).

### What it fetches

Two libraries, two sources:

| Library | Used for | Source | Pinned? |
|---|---|---|---|
| `libIOTCAPIs_ALL.so` | Tutk cameras — V2, V3, V4, Pan, Outdoor, original Doorbell, OG, Battery Cam Pro, Robot Vacuum | [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)'s prebuilt `app/lib/lib.{amd64,arm64,arm}` | ✅ SHA256 pinned |
| `libiotp2pav.so` | GUTES cameras — Wyze Doorbell Pro, possibly Pro 2 | [APKPure](https://apkpure.com/wyze/com.hualai/download) — extracted from the Wyze Android XAPK | ❌ unpinned (rotates per Wyze app release) |

### Usage

```bash
# Fetch both for the host's architecture (most common):
npx wyze-api-fetch-wyze-sdk

# Equivalent if you have wyze-api as a local dep:
node node_modules/wyze-api/scripts/fetch-wyze-sdk.js

# Fetch only Tutk (fast, no APK download):
npx wyze-api-fetch-wyze-sdk --type tutk

# Fetch only GUTES (slow — downloads ~400MB XAPK):
npx wyze-api-fetch-wyze-sdk --type gutes

# Verify what's on disk without downloading:
npx wyze-api-fetch-wyze-sdk --verify-only

# Use a locally-downloaded XAPK for GUTES (no APKPure access):
npx wyze-api-fetch-wyze-sdk --type gutes --xapk /path/to/wyze.xapk

# Force re-download:
npx wyze-api-fetch-wyze-sdk --force

# Custom target directory:
npx wyze-api-fetch-wyze-sdk --target /opt/wyze-sdk
```

Default target: `~/.homebridge/wyze-sdk/`

### Exit codes

- `0` — all requested files present and verified
- `1` — at least one file failed
- `2` — unsupported platform (macOS / Windows — see below)
- `3` — CLI usage error

### Platform support

These binaries are **Linux ELF** (extracted from the Android APK).
They can't be loaded on macOS or Windows. The script refuses to run
on those platforms by default to fail-fast instead of producing useless
files.

| Platform | Tutk | GUTES |
|---|---|---|
| Linux x86_64 (NAS, server) | ✅ | ✅ |
| Linux arm64 (Pi 4/5, Apple silicon Linux VM) | ✅ | ✅ |
| Linux armv7 (older Pi) | ✅ | ✅ |
| macOS | ❌ | ❌ |
| Windows | ❌ | ❌ |

If you need the files on a non-Linux host (e.g. preparing them for a
NAS), set `WYZE_SDK_ALLOW_NON_LINUX=1` to bypass the platform check.

### Safety

- **Pinned download hosts**: only `raw.githubusercontent.com/mrlt8/...`
  and APKPure's CDNs. Redirects to other hosts are refused.
- **Pinned SHA256** for the Tutk libraries — a mismatch fails loudly
  and leaves your target dir untouched. Update the manifest in the
  script when docker-wyze-bridge bumps the binaries.
- **No code execution** during fetch. Just download + checksum +
  write. The `.so` files aren't loaded by the script itself.

### When SHA256s drift

If docker-wyze-bridge updates their `lib.*` files (rare — they ship
new builds every few months at most), the script's pinned SHA256
won't match and the fetch will fail with a clear message containing
the new SHA256:

```
✗ Tutk: SHA256 mismatch
  expected aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  got      f7ec63dcb589e1b6bf0b8921af80d9d29ea0ddc4b2437170cbec28b08faa516e
```

Update `TUTK_MANIFEST` in `fetch-wyze-sdk.js` with the new value (after
verifying it matches the source repo's commit history) and re-run.

### Why GUTES isn't SHA256-pinned

The Wyze APK rotates with every app release, so the `libiotp2pav.so`
hash changes each time. Pinning would force a manual update for every
Wyze app version. The integrity boundary for GUTES is the TLS
connection to APKPure + their content-addressed CDN; not as strong as
SHA pinning, but practical.

If you want stricter validation for production use, run the script
once, record the SHA256 of the resulting `libiotp2pav.so`, and add
your own verification check before loading it. Or pin the SHA256 by
editing `GUTES_MANIFEST` and adding an expected `sha256` field.

### When does the plugin call this?

Currently: never. The plugin doesn't auto-fetch yet — the protocol
ports under `example/` are still dev/research only.

The eventual design (per earlier planning conversation) is for the
bridge to call this script's underlying functions when a user enables
`advanced.tutk.enabled: true` or `advanced.gutes.enabled: true` in
their homebridge config, with a clear log message if the auto-fetch
fails and the plugin falls back to cloud streaming.

For now, the script is a standalone CLI for early testing.
