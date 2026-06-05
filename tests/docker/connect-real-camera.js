#!/usr/bin/env node
"use strict";

/**
 * Real-camera smoke test — first attempt to actually talk to a Wyze
 * camera over the LAN using the Phase 1 Tutk loader + session.
 *
 * Reads credentials from env vars (NEVER hardcode):
 *   WYZE_USERNAME / WYZE_PASSWORD / WYZE_KEY_ID / WYZE_API_KEY
 *   WYZE_CAMERA_NICK   — nickname of the camera to test against
 *                         (optional; first online camera if omitted)
 *
 * What this does, in order:
 *   1. Log in to Wyze cloud via the existing wyze-api
 *   2. Fetch the device list, pick a camera
 *   3. Extract uid (device_params.p2p_id) + enr from the camera's
 *      cloud blob — both must be present
 *   4. Instantiate TutkSession + connect()
 *      (this is the moment of truth — IOTC over LAN + auth handshake)
 *   5. send(K10090GetCameraTime) → log the camera's reported time
 *   6. close() cleanly
 *
 * Run via Docker (recommended; from wyze-api repo root):
 *
 *   ./tests/docker/run-real-camera-smoke.sh
 *
 * Run directly (only works on Linux with the .so present):
 *
 *   WYZE_USERNAME=... WYZE_PASSWORD=... WYZE_KEY_ID=... WYZE_API_KEY=... \
 *     WYZE_CAMERA_NICK="<your camera nickname>" \
 *     node tests/docker/connect-real-camera.js
 *
 * Exit codes:
 *   0 — connect + send + close all succeeded
 *   1 — any step failed (specific failure printed)
 *   2 — credentials missing
 */

const path = require("path");
const os = require("os");

const REQUIRED_ENV = ["WYZE_USERNAME", "WYZE_PASSWORD", "WYZE_KEY_ID", "WYZE_API_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error(`See the head comment in this file for details.`);
  process.exit(2);
}

function log(label, val) {
  console.log(`  ${label.padEnd(28)} ${val}`);
}
function section(name) {
  console.log(`\n--- ${name} ---`);
}

async function main() {
  const startMs = Date.now();

  // ---- 1. Wyze cloud login + device list -----------------------------

  section("Wyze cloud — login + device list");

  const WyzeAPI = require("../../src/index");
  const api = new WyzeAPI({
    username: process.env.WYZE_USERNAME,
    password: process.env.WYZE_PASSWORD,
    keyId: process.env.WYZE_KEY_ID,
    apiKey: process.env.WYZE_API_KEY,
    logLevel: "warn",
    persistPath: path.join(os.tmpdir(), ".wyze-real-camera-smoke"),
  });

  let devices;
  try {
    devices = await api.getDeviceList();
  } catch (e) {
    console.error(`✗ login / device list failed: ${e.message}`);
    process.exit(1);
  }
  log("devices on account", devices.length);

  // ---- 2. Pick a camera ----------------------------------------------

  // Camera product_types in the wild: "Camera". Filter to online ones.
  const cameras = devices.filter((d) => d.product_type === "Camera");
  log("cameras", cameras.length);
  const online = cameras.filter((d) => d.conn_state === 1);
  log("online cameras", online.length);

  if (online.length === 0) {
    console.error(`✗ no online cameras — can't test`);
    process.exit(1);
  }

  let chosen;
  if (process.env.WYZE_CAMERA_NICK) {
    chosen = online.find((d) => d.nickname === process.env.WYZE_CAMERA_NICK);
    if (!chosen) {
      console.error(`✗ no online camera with nickname "${process.env.WYZE_CAMERA_NICK}"`);
      console.error(`  online cameras: ${online.map((d) => d.nickname).join(", ")}`);
      process.exit(1);
    }
  } else {
    chosen = online[0];
  }

  log("chosen", `${chosen.nickname} (${chosen.product_model})`);
  log("mac", chosen.mac);

  const p2pId = chosen.device_params?.p2p_id;
  const enr   = chosen.enr;
  const camIp = chosen.device_params?.ip;

  if (!p2pId) {
    console.error(`✗ camera has no device_params.p2p_id — Wyze cloud didn't return it`);
    console.error(`  full device_params keys: ${Object.keys(chosen.device_params || {}).join(", ")}`);
    process.exit(1);
  }
  if (!enr) {
    console.error(`✗ camera has no enr — Wyze cloud didn't return it`);
    console.error(`  top-level keys: ${Object.keys(chosen).join(", ")}`);
    process.exit(1);
  }
  log("p2p_id", `${p2pId.slice(0, 8)}…${p2pId.slice(-4)} (${p2pId.length} chars)`);
  log("enr length", `${enr.length} chars`);
  log("LAN ip (if known)", camIp || "(none — Wyze didn't report; LAN P2P may not work)");

  // ---- 3. Tutk session — the moment of truth -------------------------

  section("Tutk session — connect → send K10090 → close");

  const { TutkSession, TutkSessionError } = require("../../src/tutk/session");
  const M = require("../../src/tutk/lib/messages");

  // Generate stable phoneId from the host (Tutk wants something
  // consistent so the camera can rate-limit per client; doesn't need
  // to be secret).
  const phoneId = `wyze-api-smoke-${os.hostname()}-${process.pid}`;
  const openUserId = chosen.user_id || "wyze-api-smoke-user";

  const sess = new TutkSession({
    uid: p2pId,
    enr: enr,
    productModel: chosen.product_model,
    mac: chosen.mac,
    phoneId,
    openUserId,
    log: (level, msg) => console.log(`    [${level}] ${msg}`),
  });

  let ok = true;

  // 3a. connect()
  const tConnect = Date.now();
  try {
    await sess.connect();
    log("connect()", `✓ in ${Date.now() - tConnect}ms — state=${sess.state}`);
  } catch (e) {
    console.error(`  connect() ✗ in ${Date.now() - tConnect}ms`);
    console.error(`    ${e.name}: ${e.message}`);
    if (e.code !== undefined) console.error(`    sdk error code: ${e.code}`);
    // Specific hint for the most common cause of "connect timed out"
    // — Docker Desktop on Mac/Windows isolating the container from
    // the LAN. See tests/docker/README.md for the three workarounds.
    if (/timed out/.test(e.message) && camIp) {
      console.error(``);
      console.error(`    Hint: if you're running this in Docker on macOS/Windows, --network host`);
      console.error(`    joins the Docker VM's network — NOT your host's LAN — so the container`);
      console.error(`    can't reach the camera. Quick check from the container:`);
      console.error(``);
      console.error(`      docker run --rm --network host alpine ping -c 2 ${camIp}`);
      console.error(``);
      console.error(`    If that pings fail, see tests/docker/README.md "Docker Desktop for`);
      console.error(`    Mac/Windows networking" — the host-networking setting fixes this on`);
      console.error(`    Docker Desktop 4.34+.`);
    }
    ok = false;
  }

  // 3b. send K10090
  if (ok) {
    const tSend = Date.now();
    try {
      const cameraTime = await sess.send(new M.K10090GetCameraTime(), 5000);
      const skew = Math.floor(Date.now() / 1000) - cameraTime;
      log("send K10090", `✓ in ${Date.now() - tSend}ms — camera time = ${cameraTime} (skew ${skew}s)`);
    } catch (e) {
      console.error(`  send K10090 ✗ in ${Date.now() - tSend}ms — ${e.message}`);
      ok = false;
    }
  }

  // 3c. close (always run)
  const tClose = Date.now();
  try {
    await sess.close();
    log("close()", `✓ in ${Date.now() - tClose}ms — state=${sess.state}`);
  } catch (e) {
    console.error(`  close() ✗ — ${e.message}`);
    ok = false;
  }

  // ---- Summary --------------------------------------------------------

  section("Summary");
  log("total elapsed", `${Date.now() - startMs}ms`);
  log("result", ok ? "✓ ALL GOOD — Phase 1 talks to real Wyze hardware end-to-end" : "✗ at least one step failed");

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nfatal: ${e.message}`);
  if (e.stack) console.error(e.stack.split("\n").slice(1, 6).join("\n"));
  process.exit(1);
});
