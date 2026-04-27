"use strict";

const axios = require("axios");

/**
 * Hostnames the Wyze API is allowed to talk to. Anything outside this set is
 * either a sign of misconfiguration or a redirect-based credential exfil
 * attempt — we refuse to talk to it.
 *
 * This list is intentionally narrow. Wyze uses a small set of API hosts plus
 * AWS Kinesis Video signaling URLs (for WebRTC streams). The signaling URL
 * carries a one-shot signed token, not an account credential, so we don't
 * subject it to the allowlist.
 */
const WYZE_ALLOWED_HOSTNAMES = new Set([
  "auth-prod.api.wyze.com",
  "api.wyzecam.com",
  "wyze-iot3-service.api.wyze.com",
  "wyze-platform-service.wyzecam.com",
  "wyze-venus-service.wyzecam.com",
  "wyze-general-api.wyzecam.com",
  "beta-api.wyzecam.com",
]);

let _installed = false;

/**
 * Install a one-time axios interceptor that, for requests targeted at known
 * Wyze hostnames, refuses to follow HTTP redirects. Wyze's real API never
 * returns 3xx for these endpoints, so a redirect is at best a configuration
 * problem and at worst an attempt to steal the bearer token by sending it
 * to an attacker-controlled host.
 *
 * Idempotent — safe to call from multiple WyzeAPI instances.
 */
function installRedirectGuard() {
  if (_installed) return;
  _installed = true;

  axios.interceptors.request.use((config) => {
    let hostname = null;
    try {
      const full = config.baseURL
        ? new URL(config.url, config.baseURL).toString()
        : config.url;
      hostname = new URL(full).hostname;
    } catch (_) {
      // If we can't parse the URL, let axios surface the error naturally.
      return config;
    }
    if (hostname && WYZE_ALLOWED_HOSTNAMES.has(hostname)) {
      // 0 = throw on any 3xx instead of silently following.
      config.maxRedirects = 0;
    }
    return config;
  });
}

module.exports = {
  WYZE_ALLOWED_HOSTNAMES,
  installRedirectGuard,
};
