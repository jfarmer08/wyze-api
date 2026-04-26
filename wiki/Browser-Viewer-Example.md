# Browser Viewer Example

A minimal HTTP server + browser UI that lists your cameras, plays live WebRTC streams, and grabs snapshots — built on the camera helpers documented in [Camera Streaming](Camera-Streaming.md).

## Run it

```bash
git clone https://github.com/jfarmer08/wyze-api.git
cd wyze-api/example
npm install
cp .env.example .env
# Edit .env with your Wyze credentials
npm run viewer
# → http://localhost:3030
```

By default the viewer runs on **port 3030**. Override with `VIEWER_PORT=8080 npm run viewer` or set `VIEWER_PORT` in `example/.env`.

## What it does

- **Lists all cameras** (online/offline) on the landing page with thumbnails.
- **Click a camera tile** to open a live WebRTC stream in the browser. Toggle main/sub stream quality.
- **Snapshot button** fetches a current image — cloud thumbnail when available, live WebRTC capture otherwise. The `X-Snapshot-Source` response header tells you which path was used.

## File map

| File | What it is |
|---|---|
| [example/viewer.js](../example/viewer.js) | HTTP server (Node http module, no Express). Routes below. |
| [example/public/viewer.html](../example/public/viewer.html) | Single-page browser app — vanilla JS, no build step. |
| [example/.env.example](../example/.env.example) | Template for credentials + viewer port. |

## Routes (all under [example/viewer.js](../example/viewer.js))

| Route | Returns |
|---|---|
| `GET /` | Serves `viewer.html` |
| `GET /api/cameras` | `{cameras: [Summary[]]}` from `wyze.getCameraSummaries()` |
| `GET /api/stream-params?mac=&productModel=&substream=` | Stream credentials from `getCameraWebRTCConnectionInfo` (cache bypassed for fresh URLs) |
| `GET /api/snapshot?mac=` | `image/jpeg` bytes via `getCameraSnapshotImage`. `X-Snapshot-Source: cloud\|capture` header indicates which path was used. |
| `GET /api/thumbnail?url=` | Proxies a remote thumbnail image (CORS workaround for cloud URLs) |
| `GET /api/debug/devices` | Raw camera device JSON — useful for confirming online-state field detection |
| `GET /api/health` | `{ok: true}` |

## Adapting for your own UI

The HTTP routes are intentionally minimal — read `viewer.js`, copy the route handlers you need, drop them into your own framework. The library calls themselves (`getCameraSummaries`, `getCameraWebRTCConnectionInfo`, `getCameraSnapshotImage`) are the actual interface; the example just wraps them in HTTP.

## Adapting for Homebridge

The same library calls work inside a Homebridge plugin — `getCameraSnapshotImage` for HomeKit snapshot requests, `getCameraWebRTCConnectionInfo` if you wire up an actual WebRTC bridge. No extra dependencies; everything is `package.json`-installable.

## See also

- **[Camera Streaming](Camera-Streaming.md)** — the underlying methods
- **[Snapshot Capture](Snapshot-Capture.md)** — how the snapshot path works
- **[Troubleshooting](Troubleshooting.md)** — debugging connection issues
