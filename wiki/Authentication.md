# Authentication

Wyze requires four pieces of credentials to log in: account `username` + `password`, plus a developer `keyId` + `apiKey`. Get the latter two from <https://developer-api-console.wyze.com/>. MFA accounts also need a `mfaCode`.

You don't normally call `login()` directly — every public method calls `maybeLogin()` first.

## Token persistence (recommended)

```js
const wyze = new Wyze({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: "./",
});
```

With `persistPath` set, tokens are written to `<persistPath>/wyze-<uuid-from-username>.json` and loaded on subsequent `maybeLogin()` calls. **Without it, every process restart triggers a fresh login** — Wyze rate-limits aggressive logins and may temporarily lock the account.

## Login flow

```
maybeLogin()
  ├── access_token in memory? → return
  ├── load tokens from persistPath → done
  ├── debounce passed? → login()
  └── debounce active? → wait, retry
```

### Debounce

Repeated failed logins double the debounce up to 5 minutes (`loginAttemptDebounceMilliseconds`). After 12 hours of inactivity the debounce resets to 1 second. This protects against brute-force loops if your credentials are wrong.

If you see:

```
Attempting to login before debounce has cleared, waiting N seconds
```

…something else is failing. Check `apiLogEnabled: true` to see the actual API error.

## MFA

Pass the current TOTP code as `mfaCode` in the constructor:

```js
const wyze = new Wyze({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  mfaCode: "123456",
  persistPath: "./",
});
```

Once a successful login persists the tokens, you can drop `mfaCode` for subsequent runs (until tokens expire ~60h later).

## Refresh

```js
await wyze.refreshToken();
```

Renews `access_token` using the cached `refresh_token`. Retried once on transient failure. Pass `refreshTokenTimerEnabled: true` in the constructor to run it automatically every 48 hours on a `setInterval`.

Tokens are good for ~60 hours; 48 hours is a comfortable refresh window.

## Manual login

```js
await wyze.login();
```

Forces a fresh login regardless of cached tokens. Useful for diagnosis. Throws `"Invalid credentials..."` on auth failure or `"ApiKey Required" / "KeyId Required"` if either is missing.

## Common errors

| Error | Cause |
|---|---|
| `ApiKey Required` / `KeyId Required` | Missing constructor option |
| `Invalid credentials` | Wrong password, bad keyId/apiKey, or MFA not provided when account requires it |
| `UserIsLocked` (in API responses) | Too many failed logins; wait, then retry with correct creds |
| `Wyze access token error` | Token expired mid-session — handled automatically; the error message tells you to retry |

See [Troubleshooting](Troubleshooting.md) for more.
