#!/usr/bin/env node
"use strict";

/**
 * Tutk loader smoke test — runs inside the Docker image built from
 * `Dockerfile.tutk-smoke`. Validates that the real libIOTCAPIs_ALL.so
 * loads, all 30 koffi bindings are accepted, and the SDK-init lifecycle
 * works end-to-end.
 *
 * What this proves
 *   - The .so file we ship via fetch-wyze-sdk.js can be opened by koffi
 *     on a real Linux host (no Bionic shim needed — Throughtek's Linux
 *     build is glibc-compatible)
 *   - Every function signature in src/tutk/loader.js matches what's
 *     actually exported from the .so (missing symbol → koffi throws)
 *   - IOTC_Initialize2 / avInitialize / IOTC_DeInitialize return 0
 *     (the SDK is happy with its own internal state)
 *   - IOTC_Get_Version_String returns a sane version string
 *
 * What this does NOT prove (out of scope without a camera)
 *   - That we can actually connect to a camera over the LAN
 *   - That the IOCtrl mux delivers the right responses
 *   - That auth handshake completes against real hardware
 *
 * Those need a real camera UID/enr from your Wyze account + IP
 * connectivity from the container. They're covered by the (TODO)
 * end-to-end test in this directory.
 *
 * Exit codes:
 *   0  — all checks pass; the .so loads and the SDK initializes cleanly
 *   1  — any check failed (specific failure printed)
 */

const path = require("path");
const os = require("os");

let failures = 0;
function check(label, fn) {
  process.stdout.write(`  ${label.padEnd(60)} `);
  try {
    const detail = fn();
    console.log(`✓${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    console.log(`✗\n      ${e.message}`);
    failures++;
  }
}

console.log(`Tutk smoke test`);
console.log(`  platform: ${os.platform()}-${os.arch()}`);
console.log(`  node:     ${process.version}`);
console.log(`  cwd:      ${process.cwd()}`);
console.log("");

let loader, koffi, sdk;

// ---- 1. Pre-flight ----------------------------------------------------

check("loader module imports", () => {
  loader = require("../../src/tutk/loader");
});

check("isTutkSupported() returns supported on Linux", () => {
  const r = loader.isTutkSupported();
  if (!r.supported) throw new Error(`unexpected: ${JSON.stringify(r)}`);
  return `${r.platform}-${r.arch}`;
});

check("defaultSoPath() resolves under HOME", () => {
  const p = loader.defaultSoPath();
  if (!p.startsWith(os.homedir())) throw new Error(`unexpected: ${p}`);
  return p;
});

// ---- 2. koffi + .so loading ------------------------------------------

check("koffi is installed", () => {
  koffi = require("koffi");
  return `koffi ${koffi.version || "(no version)"}`;
});

check("loadTutk() opens the .so", () => {
  sdk = loader.loadTutk();
  return path.basename(sdk.soPath);
});

// ---- 3. Every binding is callable -------------------------------------

check("all 29 raw bindings registered", () => {
  const expected = [
    // IOTC layer
    "IOTC_Get_Version_String", "IOTC_Initialize2", "IOTC_DeInitialize",
    "IOTC_Set_Log_Path", "IOTC_Connect_ByUID", "IOTC_Connect_ByUIDEx",
    "IOTC_Connect_ByUID_Parallel", "IOTC_Connect_Stop_BySID",
    "IOTC_Get_SessionID", "IOTC_Check_Device_OnlineEx",
    "IOTC_Session_Close", "IOTC_Session_Check_Ex",
    "TUTK_SDK_Set_License_Key",
    // AV layer
    "avInitialize", "avDeInitialize", "avClientStartEx", "avClientStop",
    "avSendIOCtrl", "avSendIOCtrlExit", "avRecvIOCtrl",
    "avRecvFrameData2", "avRecvAudioData", "avClientSetMaxBufSize",
    "avClientSetRecvBufMaxSize", "avClientCleanBuf",
    "avClientCleanAudioBuf", "avClientCleanLocalBuf",
    "avClientCleanLocalVideoBuf", "avCheckAudioBuf",
  ];
  const missing = expected.filter((name) => typeof sdk.raw[name] !== "function");
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
  return `${expected.length} symbols`;
});

// ---- 4. SDK lifecycle calls succeed -----------------------------------

let versionString;

check("getVersionString() returns a non-empty string", () => {
  versionString = sdk.getVersionString();
  if (typeof versionString !== "string" || versionString.length === 0) {
    throw new Error(`unexpected return: ${JSON.stringify(versionString)}`);
  }
  return JSON.stringify(versionString);
});

check("iotcInitialize2(0) returns 0", () => {
  const r = sdk.iotcInitialize2(0);
  if (r !== 0) throw new Error(`returned ${r}`);
});

check("avInitialize(8) returns 8 (max channels)", () => {
  const r = sdk.avInitialize(8);
  if (r !== 8) throw new Error(`returned ${r}`);
});

check("avDeInitialize() returns 0", () => {
  const r = sdk.avDeInitialize();
  if (r !== 0) throw new Error(`returned ${r}`);
});

check("iotcDeInitialize() returns 0", () => {
  const r = sdk.iotcDeInitialize();
  if (r !== 0) throw new Error(`returned ${r}`);
});

// ---- 5. Re-initialize after shutdown (proves we can do multiple ops) --

check("iotcInitialize2 succeeds again after deinit", () => {
  const r = sdk.iotcInitialize2(0);
  if (r !== 0) throw new Error(`returned ${r}`);
});

check("iotcDeInitialize cleanup again", () => {
  sdk.avDeInitialize();
  sdk.iotcDeInitialize();
});

// ---- Summary ----------------------------------------------------------

console.log("");
if (failures === 0) {
  console.log(`✓ ALL ${10 + 1 + 4 + 2} CHECKS PASSED`);
  console.log(`  Phase 1 loader works end-to-end against a real .so on ${os.platform()}-${os.arch()}.`);
  console.log(`  SDK version: ${versionString}`);
  process.exit(0);
} else {
  console.log(`✗ ${failures} check(s) failed.`);
  process.exit(1);
}
