"use strict";

/**
 * One-stop security module for the Wyze API:
 *   - Log redaction (bearer tokens, credentials, GPS, emails, MACs)
 *   - Secrets loading (file with mode-600 check + env-var fallback)
 *   - Base URL validation (https-only, allowlisted hostnames)
 *   - Axios redirect guard (refuses 3xx on Wyze hosts)
 *   - Device-name sanitization for HomeKit
 *
 * Lives in the API submodule so any consumer of the published wyze-api
 * package gets the same hardening — the homebridge plugin just imports
 * the bits it needs from here.
 */

const fs = require("fs");
const path = require("path");
const net = require("net");
const axios = require("axios");
const constants = require("../constants");

// ---- Constants ----------------------------------------------------------

// Sourced from ../constants so there's one canonical definition of the
// base URLs — re-exported here for callers that want them alongside the
// allowlist / validator.
const DEFAULT_AUTH_BASE_URL = constants.authBaseUrl;
const DEFAULT_API_BASE_URL  = constants.apiBaseUrl;

// Derive the redirect-guard allowlist by extracting the hostname from
// every `*BaseUrl` constant. Adding a new endpoint in constants.js
// automatically allowlists it — no parallel list to keep in sync.
const WYZE_ALLOWED_HOSTNAMES = new Set(
  Object.entries(constants)
    .filter(([k, v]) => typeof v === "string" && /BaseUrl$/.test(k) && /^https?:\/\//.test(v))
    .map(([, v]) => new URL(v).hostname)
);

// Constructor option keys for the WyzeAPI client — used by the secrets
// loader to know which fields to merge from secretsFile / env vars.
const CREDENTIAL_KEYS = [
  "username", "password", "mfaCode", "keyId", "apiKey",
  "authApiKey", "phoneId", "appName", "appVer", "appVersion",
  "userAgent", "sc", "sv",
  "fordAppKey", "fordAppSecret",
  "oliveSigningSecret", "oliveAppId", "appInfo",
];

const ENV_MAP = {
  username: "WYZE_USERNAME",
  password: "WYZE_PASSWORD",
  mfaCode: "WYZE_MFA_CODE",
  keyId: "WYZE_KEY_ID",
  apiKey: "WYZE_API_KEY",
  authApiKey: "WYZE_AUTH_API_KEY",
  phoneId: "WYZE_PHONE_ID",
  appName: "WYZE_APP_NAME",
  appVer: "WYZE_APP_VER",
  appVersion: "WYZE_APP_VERSION",
  userAgent: "WYZE_USER_AGENT",
  sc: "WYZE_SC",
  sv: "WYZE_SV",
  fordAppKey: "WYZE_FORD_APP_KEY",
  fordAppSecret: "WYZE_FORD_APP_SECRET",
  oliveSigningSecret: "WYZE_OLIVE_SIGNING_SECRET",
  oliveAppId: "WYZE_OLIVE_APP_ID",
  appInfo: "WYZE_APP_INFO",
};

// Keys whose values should be redacted from log output. Different from
// CREDENTIAL_KEYS above — these are the field names that show up in
// JSON dumps of API responses (`"access_token":"..."`, etc.).
const REDACT_KEYS = [
  "password", "apiKey", "keyId",
  "access_token", "refresh_token", "accessToken", "refreshToken",
  "authorization",
  "fordAppSecret", "fordAppKey",
  "oliveSigningSecret", "oliveAppId",
  "authApiKey",
];

const MAX_LOG_LINE = 2000;

// ---- Log redaction ------------------------------------------------------

const REDACT_RE = (() => {
  const escaped = REDACT_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(\\b(?:${escaped})\\b"?\\s*[:=]\\s*)("?)([^"\\s,}]+)("?)`, "gi");
})();

/**
 * Run a log line through every redactor. Pure function — same input
 * always produces the same output. Safe for any string; non-string
 * input is coerced via String().
 */
function sanitizeLogMessage(input) {
  let s = String(input);

  // Strip newlines / tabs / control chars so a multi-line payload
  // can't break log parsing or smuggle escape sequences.
  s = s.replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1F\x7F]/g, "");

  // Bearer auth headers.
  s = s.replace(/\bBearer\s+[-._~+/0-9a-zA-Z]+=*\b/g, "Bearer [REDACTED]");

  // JSON-encoded or bare key=value credentials.
  s = s.replace(REDACT_RE, (_m, prefix) => `${prefix}[REDACTED]`);

  // GPS coordinates — matches lat / lon / lng / latitude / longitude
  // in plausible ranges so we don't false-positive on random floats.
  s = s.replace(
    /(["']?)(lat(?:itude)?)(["']?\s*[:=]\s*)(-?(?:90(?:\.0+)?|[0-8]?\d(?:\.\d+)?))/gi,
    (_m, q, name, sep) => `${q}${name}${sep}[REDACTED_LAT]`
  );
  s = s.replace(
    /(["']?)(lon(?:gitude)?|lng)(["']?\s*[:=]\s*)(-?(?:180(?:\.0+)?|1[0-7]\d(?:\.\d+)?|[0-9]?\d(?:\.\d+)?))/gi,
    (_m, q, name, sep) => `${q}${name}${sep}[REDACTED_LON]`
  );

  // Street addresses.
  s = s.replace(
    /(["']?)((?:formatted_)?address)(["']?\s*[:=]\s*)(["'])([^"']*)(["'])/gi,
    (_m, q1, name, sep, oq, _val, cq) => `${q1}${name}${sep}${oq}[REDACTED]${cq}`
  );

  // Email addresses — keep first letter so duplicate accounts can still
  // be told apart in logs.
  s = s.replace(
    /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    (_m, first) => `${first}***@***`
  );

  // MAC addresses — preserve last octet for device disambiguation.
  s = s.replace(/\b([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g, (mac) => {
    const parts = mac.split(":");
    return "xx:xx:xx:xx:xx:" + parts[5];
  });

  // Bound length so a misbehaving payload can't blow up the log.
  return s.length <= MAX_LOG_LINE ? s : s.slice(0, MAX_LOG_LINE) + "…";
}

// ---- Device name sanitization -------------------------------------------

/**
 * Bound + strip control chars on a Wyze nickname before it's used as a
 * HomeKit accessory name (HomeKit has a 64-char limit and rejects
 * control chars). Returns "Wyze Device" as a cosmetic fallback so we
 * never end up with an empty string.
 */
function sanitizeDeviceName(name) {
  const clean = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();
  if (clean.length === 0) return "Wyze Device";
  return clean.length <= 64 ? clean : clean.slice(0, 64) + "…";
}

// ---- Secrets loading ----------------------------------------------------

function loadSecretsFromFile(secretsFile) {
  // Reject paths that escape the working tree or are absolute — prevents
  // accidental loading of system files via misconfig.
  if (secretsFile.includes("..") || path.isAbsolute(secretsFile)) {
    throw new Error("Invalid file path");
  }
  const stat = fs.statSync(secretsFile);
  // Mode 600 — owner read/write only.
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Secrets file permissions too open: ${secretsFile}. ` +
      "Set mode to 600 (owner read/write only)."
    );
  }
  const raw = fs.readFileSync(secretsFile, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function resolveSecrets(config, log) {
  const merged = { ...config };

  if (config?.secretsFile) {
    try {
      const fromFile = loadSecretsFromFile(config.secretsFile);
      for (const k of CREDENTIAL_KEYS) {
        if (fromFile[k] != null && fromFile[k] !== "") merged[k] = fromFile[k];
      }
      log?.info?.("Loaded secrets from secretsFile");
    } catch (e) {
      log?.error?.(`Failed to load secretsFile: ${e?.message || e}`);
      throw e;
    }
  }

  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const v = process.env[envName];
    if (v == null || v === "") continue;
    if (key === "appInfo") {
      try { merged.appInfo = JSON.parse(v); } catch { merged.appInfo = v; }
      continue;
    }
    merged[key] = v;
  }

  return merged;
}

// ---- Base URL validation ------------------------------------------------

function validateBaseUrl(urlString) {
  const u = new URL(urlString);
  if (u.protocol !== "https:") {
    throw new Error(`Base URL must use https: ${urlString}`);
  }
  if (net.isIP(u.hostname) !== 0) {
    throw new Error(`IP literals are not allowed in base URLs: ${urlString}`);
  }
  const lower = u.hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error(`Local hostnames are not allowed in base URLs: ${urlString}`);
  }
  return u;
}

function getValidatedBaseUrls(config, log) {
  const hasCustom = Boolean(config?.authBaseUrl || config?.apiBaseUrl);
  const allowCustom = Boolean(config?.dangerouslyAllowCustomBaseUrls);

  if (hasCustom && !allowCustom) {
    log?.error?.(
      "Custom authBaseUrl/apiBaseUrl are ignored for security. " +
      "If you understand the risks and still want this, set dangerouslyAllowCustomBaseUrls=true."
    );
    return { authBaseUrl: DEFAULT_AUTH_BASE_URL, apiBaseUrl: DEFAULT_API_BASE_URL };
  }
  if (!hasCustom) {
    return { authBaseUrl: DEFAULT_AUTH_BASE_URL, apiBaseUrl: DEFAULT_API_BASE_URL };
  }

  const authUrl = config.authBaseUrl ? validateBaseUrl(config.authBaseUrl) : new URL(DEFAULT_AUTH_BASE_URL);
  const apiUrl  = config.apiBaseUrl  ? validateBaseUrl(config.apiBaseUrl)  : new URL(DEFAULT_API_BASE_URL);

  if (!WYZE_ALLOWED_HOSTNAMES.has(authUrl.hostname) || !WYZE_ALLOWED_HOSTNAMES.has(apiUrl.hostname)) {
    throw new Error(
      `Custom base URL hostnames must be one of: ${Array.from(WYZE_ALLOWED_HOSTNAMES).join(", ")}. ` +
      "Refusing to start."
    );
  }

  return {
    authBaseUrl: authUrl.toString().replace(/\/+$/, ""),
    apiBaseUrl: apiUrl.toString().replace(/\/+$/, ""),
  };
}

// ---- Axios redirect guard -----------------------------------------------

let _interceptorInstalled = false;

/**
 * Install a one-time axios interceptor that refuses to follow HTTP
 * redirects on requests bound for known Wyze hostnames. Wyze's real API
 * never returns 3xx for these endpoints, so a redirect is at best a
 * configuration problem and at worst an attempt to steal the bearer
 * token by sending it to an attacker-controlled host.
 *
 * Idempotent — safe to call from multiple WyzeAPI instances.
 * Other axios consumers in the same Node process aren't affected
 * because the guard only applies to allowlisted hosts.
 */
function installRedirectGuard() {
  if (_interceptorInstalled) return;
  _interceptorInstalled = true;
  axios.interceptors.request.use((config) => {
    let hostname = null;
    try {
      const full = config.baseURL ? new URL(config.url, config.baseURL).toString() : config.url;
      hostname = new URL(full).hostname;
    } catch (_) {
      return config;
    }
    if (hostname && WYZE_ALLOWED_HOSTNAMES.has(hostname)) {
      config.maxRedirects = 0;
    }
    return config;
  });
}

module.exports = {
  // Constants
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_API_BASE_URL,
  WYZE_ALLOWED_HOSTNAMES,
  CREDENTIAL_KEYS,
  REDACT_KEYS,
  ENV_MAP,
  // Redaction
  sanitizeLogMessage,
  // Device name
  sanitizeDeviceName,
  // Secrets
  loadSecretsFromFile,
  resolveSecrets,
  // URLs
  validateBaseUrl,
  getValidatedBaseUrls,
  // Axios hardening
  installRedirectGuard,
};
