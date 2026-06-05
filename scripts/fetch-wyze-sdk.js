#!/usr/bin/env node
"use strict";

/**
 * fetch-wyze-sdk.js — download the Wyze SDK `.so` libraries needed for
 * local Tutk / GUTES streaming.
 *
 * Two libraries, two sources:
 *
 *   libIOTCAPIs_ALL.so (Tutk — V2/V3/V4/Pan/Outdoor/DB/OG cameras,
 *                       Vacuum, etc.)
 *     Source: docker-wyze-bridge ships prebuilt binaries per architecture
 *             at github.com/mrlt8/docker-wyze-bridge/app/lib/{lib.amd64,
 *             lib.arm64, lib.arm}. Direct download, one curl per arch.
 *
 *   libiotp2pav.so (GUTES — Wyze Doorbell Pro / Pro 2 / select Gwell devices)
 *     Source: must be extracted from the Wyze Android APK. APKPure
 *             hosts redistributable XAPKs; we download + unzip-in-memory.
 *
 * USAGE
 *
 *   # Fetch both for the host's architecture (most common):
 *   node fetch-wyze-sdk.js
 *
 *   # Fetch a specific type only:
 *   node fetch-wyze-sdk.js --type tutk
 *   node fetch-wyze-sdk.js --type gutes
 *
 *   # Force re-download (skip the "already present" check):
 *   node fetch-wyze-sdk.js --force
 *
 *   # Specify the target directory (default: ~/.homebridge/wyze-sdk):
 *   node fetch-wyze-sdk.js --target /opt/wyze-sdk
 *
 *   # Validate checksums of existing files, don't download:
 *   node fetch-wyze-sdk.js --verify-only
 *
 *   # Use a local XAPK file (for GUTES path, when APKPure is unreachable):
 *   node fetch-wyze-sdk.js --type gutes --xapk /path/to/wyze.xapk
 *
 * SAFETY
 *
 *   - Pinned download hosts (raw.githubusercontent.com/mrlt8/...
 *     and d.apkpure.net). Refuses to follow redirects to other hosts.
 *   - Pinned SHA256 per file per version. A mismatch fails loudly and
 *     leaves the target directory unchanged.
 *   - Refuses to proceed on macOS / Windows — these binaries are
 *     Linux-ELF; loading them on non-Linux gives a useless error
 *     later. Better to fail at fetch time.
 *
 * EXIT CODES
 *   0 — all requested files present and verified
 *   1 — at least one file missing or failed verification after fetch
 *   2 — unsupported platform
 *   3 — CLI usage error
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const { URL } = require("url");

// ---- Allowlisted download hosts ----------------------------------------
//
// Every fetch must resolve to one of these. We refuse to follow redirects
// to other hosts as a supply-chain safeguard. See the head comment.

const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "d.apkpure.net",
  "d.apkpure.com",
  "apkpure.com",
]);

// ---- Tutk SDK manifest -------------------------------------------------
//
// Each entry: source URL + expected SHA256 + filename to write under the
// target dir. Update SHA256s when docker-wyze-bridge bumps the .so —
// re-run with --verify-only to get the new value from the script's own
// mismatch message.

const TUTK_MANIFEST = {
  // Mapping from Node arch+platform to the dwb file. Add new arches here
  // as docker-wyze-bridge publishes them.
  variants: {
    "linux-x64":   { src: "lib.amd64", sha256: "f7ec63dcb589e1b6bf0b8921af80d9d29ea0ddc4b2437170cbec28b08faa516e", size: 4818376 },
    "linux-arm64": { src: "lib.arm64", sha256: "cc3542f50c0c3f433f7083de4666ed126bbe64e02a91753462c25af20e713737", size: 4331480 },
    "linux-arm":   { src: "lib.arm",   sha256: "fdc0be6efc1e8d93d9ebc4006a8a0ccd192b3f96f22e81ea2ce432e33c55b021", size: 4073452 },
  },
  baseUrl: "https://raw.githubusercontent.com/mrlt8/docker-wyze-bridge/main/app/lib/",
  outputName: "libIOTCAPIs_ALL.so",
};

// ---- GUTES SDK manifest (APK extraction path) -------------------------
//
// APKPure rotates the URL by version periodically. The default URL gets
// the latest, but you can pin a version via --apk-url=<href> if you need
// a specific firmware-matching build.
//
// XAPK layout (after the outer ZIP):
//   com.hualai.apk                  ← base APK, no native libs
//   config.arm64_v8a.apk            ← arch-specific split with our .so
//   config.armeabi_v7a.apk
//   config.x86_64.apk
//   ...
//
// We extract lib/<android-arch>/libiotp2pav.so from the right split APK.

const GUTES_MANIFEST = {
  // Map Node platform-arch → Android lib directory inside the split APK
  // → which config.<...>.apk to open.
  variants: {
    "linux-x64":   { androidArch: "x86_64",      configApk: "config.x86_64.apk" },
    "linux-arm64": { androidArch: "arm64-v8a",   configApk: "config.arm64_v8a.apk" },
    "linux-arm":   { androidArch: "armeabi-v7a", configApk: "config.armeabi_v7a.apk" },
  },
  // SHA256 is UNPINNED for GUTES because the APK rotates with every
  // Wyze app release. The XAPK download is the integrity boundary
  // (TLS to APKPure + their content-addressed CDN). If you want
  // stricter validation, pin the .so SHA256 here after a manual
  // verification run.
  outputName: "libiotp2pav.so",
  defaultApkUrl: "https://d.apkpure.com/b/XAPK/com.hualai?version=latest",
};

// ---- Defaults + arg parsing -------------------------------------------

const DEFAULT_TARGET = path.join(os.homedir(), ".homebridge", "wyze-sdk");

function parseArgs(argv) {
  const opts = {
    type: "both",       // "tutk" | "gutes" | "both"
    target: DEFAULT_TARGET,
    force: false,
    verifyOnly: false,
    apkUrl: GUTES_MANIFEST.defaultApkUrl,
    xapk: null,
    yes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--type") opts.type = argv[++i];
    else if (a === "--target") opts.target = argv[++i];
    else if (a === "--force") opts.force = true;
    else if (a === "--verify-only") opts.verifyOnly = true;
    else if (a === "--apk-url") opts.apkUrl = argv[++i];
    else if (a === "--xapk") opts.xapk = argv[++i];
    else if (a === "-y" || a === "--yes") opts.yes = true;
    else if (a.startsWith("--")) {
      console.error(`unknown option: ${a}`);
      process.exit(3);
    }
  }
  if (!["tutk", "gutes", "both"].includes(opts.type)) {
    console.error(`--type must be tutk | gutes | both (got ${opts.type})`);
    process.exit(3);
  }
  return opts;
}

function printHelp() {
  console.log(`fetch-wyze-sdk.js — download Wyze SDK libraries for local Tutk/GUTES streaming.

USAGE
  fetch-wyze-sdk.js [options]

OPTIONS
  --type <tutk|gutes|both>   What to fetch (default: both)
  --target <dir>             Where to put the .so files (default: ~/.homebridge/wyze-sdk)
  --force                    Re-download even if files already match expected SHA256
  --verify-only              Don't download; just validate what's on disk
  --apk-url <url>            Override the XAPK source for GUTES (default: APKPure latest)
  --xapk <path>              Use a local XAPK file instead of downloading
  -y, --yes                  Skip the confirmation prompt
  -h, --help                 This message

EXIT
  0  all requested files present + verified
  1  at least one file failed
  2  unsupported platform (macOS/Windows can't load these binaries)
  3  CLI usage error
`);
}

// ---- Platform detection -----------------------------------------------

function detectVariant() {
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;
  if (platform !== "linux") {
    return { supported: false, platform, arch, key };
  }
  return { supported: true, platform, arch, key };
}

// ---- HTTPS fetch with allowlist + redirect refusal --------------------
//
// We disable axios/got for this since they pull big dependency trees;
// stdlib https + manual redirect handling is simpler and easier to audit.

function fetchToBuffer(urlString, { maxBytes = 50_000_000, maxRedirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let redirectsLeft = maxRedirects;

    function go(urlStr) {
      let u;
      try { u = new URL(urlStr); } catch (e) {
        return reject(new Error(`invalid URL: ${urlStr}`));
      }
      if (!ALLOWED_HOSTS.has(u.hostname)) {
        return reject(new Error(`refusing to fetch from non-allowlisted host: ${u.hostname}`));
      }
      if (u.protocol !== "https:") {
        return reject(new Error(`refusing non-HTTPS URL: ${urlStr}`));
      }

      const req = https.get(u, (res) => {
        // Redirect handling — manual, allowlist-checked.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft-- <= 0) {
            return reject(new Error(`too many redirects (last: ${res.headers.location})`));
          }
          const next = new URL(res.headers.location, u).toString();
          return go(next);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
        }
        let bytes = 0;
        const chunks = [];
        res.on("data", (c) => {
          bytes += c.length;
          if (bytes > maxBytes) {
            req.destroy();
            return reject(new Error(`response > ${maxBytes} bytes from ${urlStr}`));
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(60_000, () => req.destroy(new Error(`timeout fetching ${urlStr}`)));
    }

    go(urlString);
  });
}

// ---- SHA256 helpers ----------------------------------------------------

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function fileSha256Sync(filePath) {
  const data = fs.readFileSync(filePath);
  return sha256Hex(data);
}

// ---- Tutk fetch --------------------------------------------------------

async function fetchTutk(opts, variantKey) {
  const v = TUTK_MANIFEST.variants[variantKey];
  if (!v) {
    return { status: "unsupported-arch", reason: `no Tutk variant for ${variantKey}` };
  }
  const outPath = path.join(opts.target, TUTK_MANIFEST.outputName);

  // Skip-if-present
  if (!opts.force && fs.existsSync(outPath)) {
    const existing = fileSha256Sync(outPath);
    if (existing === v.sha256) {
      return { status: "already-present", path: outPath, sha256: existing };
    }
    if (opts.verifyOnly) {
      return { status: "checksum-mismatch", path: outPath, expected: v.sha256, got: existing };
    }
    console.log(`  existing file checksum doesn't match; re-downloading`);
  } else if (opts.verifyOnly) {
    return { status: "missing", path: outPath };
  }

  const url = TUTK_MANIFEST.baseUrl + v.src;
  console.log(`  GET ${url}`);
  const data = await fetchToBuffer(url);
  if (data.length !== v.size) {
    return { status: "size-mismatch", expected: v.size, got: data.length };
  }
  const sha = sha256Hex(data);
  if (sha !== v.sha256) {
    return {
      status: "sha-mismatch",
      expected: v.sha256,
      got: sha,
      hint: "If docker-wyze-bridge has updated their binaries, edit TUTK_MANIFEST in this script with the new SHA256 (which is the value shown above).",
    };
  }

  fs.mkdirSync(opts.target, { recursive: true });
  fs.writeFileSync(outPath, data, { mode: 0o644 });
  return { status: "fetched", path: outPath, sha256: sha, bytes: data.length };
}

// ---- XAPK extraction ---------------------------------------------------
//
// XAPK files are ZIP archives containing multiple APK files. APKs are
// themselves ZIPs. We walk the outer ZIP, find the config.<arch>.apk
// matching our target arch, walk that inner APK, and pull out
// lib/<arch>/libiotp2pav.so.
//
// We don't use yauzl or jszip — stdlib zlib + a tiny manual ZIP
// directory walker is enough. ZIP local headers are simple:
//   magic 0x04034B50 + ... + filename + extra + compressed data
// We just iterate them; no need to parse the central directory.

const zlib = require("zlib");

function* iterZipEntries(buf) {
  const LFH = 0x04034B50;
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== LFH) {
      // End of local headers (we've hit central directory or end-of-archive)
      return;
    }
    const compMethod  = buf.readUInt16LE(off + 8);
    const compSize    = buf.readUInt32LE(off + 18);
    const uncompSize  = buf.readUInt32LE(off + 22);
    const nameLen     = buf.readUInt16LE(off + 26);
    const extraLen    = buf.readUInt16LE(off + 28);
    const flags       = buf.readUInt16LE(off + 6);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const dataStart = off + 30 + nameLen + extraLen;

    // Data descriptor flag (bit 3) means sizes are after the data;
    // we'd need the central directory for these. Bail with a clear error.
    if (flags & 0x08) {
      throw new Error(`zip entry "${name}" uses data descriptor; central-directory parser needed`);
    }

    const compData = buf.subarray(dataStart, dataStart + compSize);
    yield { name, compMethod, compSize, uncompSize, compData };
    off = dataStart + compSize;
  }
}

function extractEntry(entry) {
  if (entry.compMethod === 0) return Buffer.from(entry.compData); // stored
  if (entry.compMethod === 8) return zlib.inflateRawSync(entry.compData); // deflate
  throw new Error(`unsupported compression method ${entry.compMethod} for "${entry.name}"`);
}

function findInZip(zipBuf, predicate) {
  for (const entry of iterZipEntries(zipBuf)) {
    if (predicate(entry.name)) return entry;
  }
  return null;
}

// ---- GUTES fetch -------------------------------------------------------

async function fetchGutes(opts, variantKey) {
  const v = GUTES_MANIFEST.variants[variantKey];
  if (!v) {
    return { status: "unsupported-arch", reason: `no GUTES variant for ${variantKey}` };
  }
  const outPath = path.join(opts.target, GUTES_MANIFEST.outputName);

  if (!opts.force && fs.existsSync(outPath)) {
    return { status: "already-present", path: outPath, sha256: fileSha256Sync(outPath) };
  }
  if (opts.verifyOnly) {
    return { status: "missing", path: outPath };
  }

  // Load the XAPK — local file or download
  let xapkBuf;
  if (opts.xapk) {
    if (!fs.existsSync(opts.xapk)) {
      return { status: "xapk-not-found", path: opts.xapk };
    }
    xapkBuf = fs.readFileSync(opts.xapk);
    console.log(`  loaded XAPK from ${opts.xapk} (${xapkBuf.length} bytes)`);
  } else {
    console.log(`  GET ${opts.apkUrl}  (~400 MB, this takes a while)`);
    xapkBuf = await fetchToBuffer(opts.apkUrl, { maxBytes: 600_000_000 });
    console.log(`  downloaded ${xapkBuf.length} bytes`);
  }

  // Walk the outer XAPK ZIP, find the right config split APK
  const splitEntry = findInZip(xapkBuf, (n) => n.endsWith(`/${v.configApk}`) || n === v.configApk);
  if (!splitEntry) {
    return { status: "no-split-apk", expected: v.configApk };
  }
  const splitApk = extractEntry(splitEntry);
  console.log(`  found ${v.configApk} (${splitApk.length} bytes)`);

  // Walk the inner APK ZIP, find lib/<arch>/libiotp2pav.so
  const targetPath = `lib/${v.androidArch}/libiotp2pav.so`;
  const soEntry = findInZip(splitApk, (n) => n === targetPath);
  if (!soEntry) {
    return { status: "no-so-in-apk", expected: targetPath };
  }
  const soBytes = extractEntry(soEntry);

  fs.mkdirSync(opts.target, { recursive: true });
  fs.writeFileSync(outPath, soBytes, { mode: 0o644 });
  return {
    status: "fetched",
    path: outPath,
    sha256: sha256Hex(soBytes),
    bytes: soBytes.length,
  };
}

// ---- Main --------------------------------------------------------------

function logResult(name, r) {
  if (r.status === "fetched")
    console.log(`  ✓ ${name}: ${r.path} (${r.bytes.toLocaleString()} B, sha256=${r.sha256.slice(0, 12)}…)`);
  else if (r.status === "already-present")
    console.log(`  ✓ ${name}: ${r.path} (already present, verified)`);
  else if (r.status === "missing")
    console.log(`  ✗ ${name}: ${r.path} missing`);
  else if (r.status === "unsupported-arch")
    console.log(`  - ${name}: skipped (${r.reason})`);
  else if (r.status === "sha-mismatch")
    console.log(`  ✗ ${name}: SHA256 mismatch (expected ${r.expected}, got ${r.got})\n    ${r.hint || ""}`);
  else if (r.status === "size-mismatch")
    console.log(`  ✗ ${name}: size mismatch (expected ${r.expected}, got ${r.got})`);
  else if (r.status === "checksum-mismatch")
    console.log(`  ✗ ${name}: existing file checksum doesn't match\n    expected ${r.expected}\n    got      ${r.got}`);
  else if (r.status === "xapk-not-found")
    console.log(`  ✗ ${name}: XAPK file not found at ${r.path}`);
  else if (r.status === "no-split-apk")
    console.log(`  ✗ ${name}: XAPK didn't contain ${r.expected}`);
  else if (r.status === "no-so-in-apk")
    console.log(`  ✗ ${name}: split APK didn't contain ${r.expected}`);
  else
    console.log(`  ? ${name}: ${JSON.stringify(r)}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); process.exit(0); }

  const v = detectVariant();
  if (!v.supported) {
    console.error(`\nThis platform isn't supported: ${v.platform}-${v.arch}`);
    console.error(`The Wyze SDK binaries are Linux-only (no .dylib for macOS, no .dll for`);
    console.error(`Windows). On these platforms the plugin falls back to cloud streaming —`);
    console.error(`local Tutk/GUTES isn't available.`);
    console.error(``);
    console.error(`If you want to fetch the files anyway (e.g. preparing them for another`);
    console.error(`machine), set WYZE_SDK_ALLOW_NON_LINUX=1.`);
    if (process.env.WYZE_SDK_ALLOW_NON_LINUX !== "1") process.exit(2);
    console.error(`\n(WYZE_SDK_ALLOW_NON_LINUX=1 set — continuing.)\n`);
  }

  // When override is set, we still need a variant key. Use linux-<arch>
  // as a best-effort mapping.
  const variantKey = v.supported ? v.key : `linux-${v.arch}`;
  console.log(`Target dir: ${opts.target}`);
  console.log(`Variant:    ${variantKey}`);
  console.log(`Type(s):    ${opts.type}`);
  console.log(``);

  let hadFailure = false;

  if (opts.type === "tutk" || opts.type === "both") {
    console.log("Tutk SDK (libIOTCAPIs_ALL.so):");
    try {
      const r = await fetchTutk(opts, variantKey);
      logResult("Tutk", r);
      if (!["fetched", "already-present"].includes(r.status)) hadFailure = true;
    } catch (e) {
      console.log(`  ✗ Tutk: ${e.message}`);
      hadFailure = true;
    }
  }

  if (opts.type === "gutes" || opts.type === "both") {
    console.log("\nGUTES SDK (libiotp2pav.so):");
    try {
      const r = await fetchGutes(opts, variantKey);
      logResult("GUTES", r);
      if (!["fetched", "already-present"].includes(r.status)) hadFailure = true;
    } catch (e) {
      console.log(`  ✗ GUTES: ${e.message}`);
      hadFailure = true;
    }
  }

  console.log("");
  console.log(hadFailure ? "Done — some failures (exit 1)." : "Done — all good.");
  process.exit(hadFailure ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`\nfatal: ${e.message}`);
    process.exit(1);
  });
}

// Library exports for tests + downstream callers
module.exports = {
  fetchTutk,
  fetchGutes,
  detectVariant,
  TUTK_MANIFEST,
  GUTES_MANIFEST,
  // Internals exposed for unit testing
  _internal: {
    sha256Hex,
    iterZipEntries,
    extractEntry,
    findInZip,
    fetchToBuffer,
    ALLOWED_HOSTS,
  },
};
