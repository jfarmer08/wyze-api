# Getting Started

## Install

```bash
npm install wyze-api
```

Node.js 18+ recommended. All deps install via `npm` — no system packages required.

## Minimum viable example

```js
const Wyze = require("wyze-api");

const wyze = new Wyze({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: "./",
});

(async () => {
  const devices = await wyze.getDeviceList();
  console.log(`${devices.length} devices`);
})();
```

`username` / `password` are your Wyze account credentials. `keyId` / `apiKey` come from <https://developer-api-console.wyze.com/> — Wyze requires both for new logins. See [Authentication](Authentication.md) for the full picture.

## Constructor options

| Option | Default | Notes |
|---|---|---|
| `username` | — | Wyze email |
| `password` | — | Wyze password |
| `keyId` | — | Developer key id |
| `apiKey` | — | Developer api key |
| `mfaCode` | — | TOTP code if your account has MFA enforced |
| `persistPath` | — | Directory for cached auth tokens. **Recommended** — without this, every process restart triggers a fresh login. |
| `logLevel` | `"info"` | Verbosity for the built-in `WyzeLogger`. One of `"error"` / `"warn"` / `"info"` / `"debug"`. Set to `"debug"` to log every request/response (replaces the legacy `apiLogEnabled` toggle). |
| `apiLogEnabled` | `false` | Legacy boolean — `true` is now mapped to `logLevel: "debug"` for back-compat. |
| `logPrefix` | `"Wyze"` | Bracket tag at the front of every log line so output blends in with the host application's logs. |
| `refreshTokenTimerEnabled` | `false` | When `true`, runs `refreshToken()` every 48h on a `setInterval`. |
| `lowBatteryPercentage` | `30` | Threshold used by the `checkLowBattery(value)` helper. |
| `authBaseUrl` | `https://auth-prod.api.wyze.com` | Override only for testing. |
| `apiBaseUrl` | `https://api.wyzecam.com` | Override only for testing. |
| `userAgent` | `unofficial-wyze-api/<pkg-version>` | Sent on every request. |
| `phoneId`, `appName`, `appVer`, `appVersion`, `sc`, `sv`, `authApiKey` | constants | App-emulation values. Defaults match a Wyze Android client; only override if you know exactly what you're doing. |
| `fordAppKey`, `fordAppSecret` | constants | Required for V1 lock control. |
| `oliveSigningSecret`, `oliveAppId`, `appInfo` | constants | Required for thermostat / irrigation / IoT3. |

## Running with environment variables

The convention used in [example/](../example/) is to keep credentials in a `.env` file at the repo root:

```env
USERNAME=you@example.com
PASSWORD=...
KEY_ID=...
API_KEY=...
PERSIST_PATH=./
LOG_LEVEL=info
API_LOG_ENABLED=false
```

Run with [dotenv](https://www.npmjs.com/package/dotenv):

```js
require("dotenv").config();
const wyze = new Wyze({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH,
});
```

## What's next

- **[Authentication](Authentication.md)** — token caching, MFA flow, debug a stuck login.
- **[Device Lookup](Device-Lookup.md)** — find devices, inspect state, branch by type.
- Pick a device family from the [Home](Home.md) page.
