# Fix: `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on Node 24.18.0+

## Symptom

Reported upstream as [homebridge-wyze-smart-home#307](https://github.com/jfarmer08/homebridge-wyze-smart-home/issues/307).
Users on Node.js v24.18.0+ see requests fail with:

```
[Wyze API] [ERROR] Request Failed: {"url":"app/v2/home_page/get_object_list","message":"unable to get local issuer certificate"}
```

Community workaround so far has been downgrading Node to 24.17.0 or 22.x (`sudo hb-service update-node 22.12.0`).
That works but isn't a real fix — it just avoids the affected Node versions indefinitely.

## Root cause (confirmed by direct reproduction, not guesswork)

Node v24.18.0 updated its bundled root CA store (NSS 3.123.1). That update dropped/distrusted the
legacy **"DigiCert Global Root CA"** (self-signed root, issued 2006, valid until 2031 — not expired,
just no longer in Node's default trust bundle).

Wyze's backend uses **two different DigiCert root chains** across its services:

| Host | Root | Node 24.18.0 result |
|---|---|---|
| `api.wyzecam.com` | DigiCert Global Root **CA** (legacy) | **FAILS** — `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| `yd-saas-toc.wyzecam.com` | DigiCert Global Root **CA** (legacy) | **FAILS** — same error |
| `auth-prod.api.wyze.com` | DigiCert Global Root **G2** | OK |
| `app.wyzecam.com` | DigiCert Global Root **G2** | OK |
| `hms.api.wyze.com` | DigiCert Global Root **G2** | OK |
| `wyze-sirius-service.wyzecam.com` | DigiCert Global Root **G2** | OK |

`yd-saas-toc.wyzecam.com` is the host behind `getLockInfo` and `controlLock` — so this bug also silently
breaks the original Wyze Lock (YD.LO1) lock/unlock commands on affected Node versions, not just the
`get_object_list` full-refresh call from the original report.

### How this was verified (reproducible)

```bash
# 1. Reproduce the failure on the exact affected Node version, in a clean container:
docker run --rm node:24.18.0 node -e "
require('https').request({host:'api.wyzecam.com', port:443, path:'/', method:'HEAD'}, r=>r.resume())
  .on('error', e => console.log(e.code)).end();
"
# -> UNABLE_TO_GET_ISSUER_CERT_LOCALLY

# 2. Confirm the server's chain and identify the root it depends on:
echo | openssl s_client -connect api.wyzecam.com:443 -servername api.wyzecam.com -showcerts 2>/dev/null \
  | openssl x509 -noout -issuer   # (repeat per cert in the chain)
# leaf issuer:         DigiCert TLS RSA SHA256 2020 CA1
# intermediate issuer: DigiCert Global Root CA   <-- the dropped root

# 3. Extract that exact root from a still-trusting system store (e.g. macOS keychain):
security find-certificate -c "DigiCert Global Root CA" \
  -p /System/Library/Keychains/SystemRootCertificates.keychain > digicert_global_root_ca.pem

# 4. Prove pinning it fixes the connection on Node 24.18.0:
docker run --rm -v "$PWD/digicert_global_root_ca.pem:/root_ca.pem:ro" node:24.18.0 node -e "
const fs = require('fs');
const ca = fs.readFileSync('/root_ca.pem');
require('https').request({host:'api.wyzecam.com', port:443, path:'/', method:'HEAD', ca}, r=>{
  console.log('status', r.statusCode); r.resume();
}).on('error', e => console.log(e.code)).end();
"
# -> status 403  (TLS succeeded; 403 is just the API rejecting an unauthenticated HEAD request)
```

Both `api.wyzecam.com` and `yd-saas-toc.wyzecam.com` connect successfully once that one root cert is
explicitly trusted — confirming this is the complete fix, not a partial mitigation.

## The fix to implement here

All HTTP calls in this package go through plain `axios.get/post/patch/delete(...)` with **no** custom
`https.Agent` or `ca` option anywhere (confirmed via `grep -rn "https.Agent\|rejectUnauthorized\|ca:" src/`).
Every request currently depends entirely on whatever root store the host's Node binary happens to bundle.

The fix: bundle the DigiCert Global Root CA certificate (and ideally the G2 root too, for future-proofing)
inside this package, and pass it as an explicit trust anchor on every request — so trust no longer depends
on the host's Node version at all.

### Suggested implementation

1. Add a small bundled CA file, e.g. `src/certs/digicert-global-root-ca.pem` (and optionally
   `digicert-global-root-g2.pem`), containing the PEM(s). These are public root certificates —
   safe to vendor directly, no secrets involved.

2. In `src/index.js`, near where `axios` is required (top of file) and where `_performRequest`
   builds its request config (around line 166-180, look for `baseURL: this.apiBaseUrl`), create one
   shared `https.Agent`:

   ```js
   const https = require("https");
   const fs = require("fs");
   const path = require("path");

   const EXTRA_CA_CERTS = [
     fs.readFileSync(path.join(__dirname, "certs", "digicert-global-root-ca.pem")),
     fs.readFileSync(path.join(__dirname, "certs", "digicert-global-root-g2.pem")),
   ];

   // Trust the standard system/Node CA bundle PLUS these pinned roots, so we're not
   // solely dependent on whatever root store the host Node version ships with.
   // https.globalAgent.options.ca is undefined by default (meaning "use Node's default
   // bundle"); passing an explicit `ca` array to an Agent REPLACES the default bundle
   // rather than adding to it, so the default roots must be included via
   // `tls.rootCertificates` to preserve trust for every other host.
   const tls = require("tls");
   const httpsAgent = new https.Agent({
     ca: [...tls.rootCertificates, ...EXTRA_CA_CERTS],
   });
   ```

   **Important gotcha to handle carefully:** passing a custom `ca` option to `https.Agent`
   REPLACES Node's default trust bundle for that agent — it does not append to it. So the
   agent's `ca` list must include `tls.rootCertificates` (Node's own default roots) in
   addition to the pinned DigiCert root, or every *other* HTTPS host this package talks to
   (or will talk to in the future) will stop being trusted. Verify this specifically —
   don't just test the two known-broken hosts and assume the rest still work.

3. Pass `httpsAgent` in the axios config for every request. The simplest correct approach is
   likely an axios instance created once (`axios.create({ httpsAgent })`) and used everywhere
   `axios` is currently called directly, rather than adding `httpsAgent` to every individual
   call site — check how many call sites there are first (there were ~20+ in `src/index.js`
   plus one more in `src/rokuAuth.js` as of this writing) and prefer the shared-instance
   approach to avoid missing one.

4. Test using the exact reproduction steps above (Docker + node:24.18.0) before and after the
   change, against both previously-failing hosts, to confirm the fix without needing a user
   on an affected Node version to verify it.

## Downstream: this alone does not reach existing users

Publishing a fix here (new version on npm) does **not** automatically reach people running
`homebridge-wyze-smart-home`. That plugin's `package-lock.json` pins an exact resolved
`wyze-api` version (currently `1.1.11`, already two versions behind the `^1.1.14` range
declared in its `package.json` — the lockfile has drifted out of sync before). Getting this
fix to users requires, in `homebridge-wyze-smart-home`:

1. Bump the `wyze-api` version in `package.json` (or confirm the existing range covers it).
2. Regenerate/update `package-lock.json` so it actually resolves to the new version — a
   plain `npm install` with an existing lockfile will NOT pick up a new version on its own.
3. Bump `homebridge-wyze-smart-home`'s own version and publish that release to npm — existing
   users only get updates when Homebridge (or `npm update -g`) fetches a new version of the
   *plugin* itself, not when `wyze-api` alone gets a new release.

This is the same pattern already used for v0.5.58 of the plugin ("bumps `wyze-api` to `1.1.14`,
which corrects Ford API payload signing").
