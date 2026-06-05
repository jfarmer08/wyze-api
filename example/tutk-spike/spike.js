#!/usr/bin/env node
"use strict";

/**
 * spike.js — exercise the JS Tutk Wyze protocol primitives end-to-end.
 *
 * Phase 0 dev script: does NOT talk to any real hardware. It builds
 * messages with our K-classes, parses them back through codec.decode(),
 * verifies the wire bytes match what docker-wyze-bridge would produce,
 * and times a representative workload.
 *
 * If this prints "ALL GREEN", the pure-JS Tutk protocol layer is sound.
 *
 * Run: node spike.js
 * Exit: 0 on success, 1 on failure.
 */

const { encode, decode } = require("../../src/tutk/lib/codec");
const { unpackHeader, TutkWyzeProtocolError } = require("../../src/tutk/lib/header");
const { PREFIX, PROTOCOL_VERSION, HEADER_SIZE, BITRATE, FRAME_SIZE } = require("../../src/tutk/lib/constants");
const xxtea = require("../../src/tutk/lib/xxtea");
const auth = require("../../src/tutk/lib/auth");
const M = require("../../src/tutk/lib/messages");

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}
function section(name) { console.log(`\n--- ${name} ---`); }
function timed(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

// ---- 1. Header pack/unpack ---------------------------------------------

section("Header pack/unpack");
{
  const msg = encode(10042, Buffer.from([3]));
  check(`length = 16 + body`, msg.length === HEADER_SIZE + 1);
  check(`prefix = "HL"`, msg.subarray(0, 2).toString("ascii") === "HL");
  check(`protocol = 5`, msg.readUInt16LE(2) === PROTOCOL_VERSION);
  check(`code = 10042 (0x273A)`, msg.readUInt16LE(4) === 10042);
  check(`txt_len = 1`, msg.readUInt16LE(6) === 1);
  check(`bytes 8..15 are zero (reserved)`,
    msg.subarray(8, 16).every((b) => b === 0));
  check(`body byte = 3 (NV_AUTO)`, msg[16] === 3);

  // Round-trip via decode()
  const { header, payload } = decode(msg);
  check(`decode prefix = "HL"`, header.prefix === "HL");
  check(`decode code = 10042`, header.code === 10042);
  check(`decode txt_len = 1`, header.txt_len === 1);
  check(`decode payload = [3]`, payload.equals(Buffer.from([3])));
}

// ---- 2. Validation — reject malformed input ----------------------------

section("Validation (codec rejects malformed input)");
{
  try {
    decode(Buffer.alloc(8));
    check(`reject < 16 byte buffer`, false, "should have thrown");
  } catch (e) {
    check(`reject < 16 byte buffer`, e instanceof TutkWyzeProtocolError);
  }
  try {
    const bad = Buffer.alloc(16);
    bad.writeUInt16LE(0x4142, 0); // "AB" not "HL"
    decode(bad);
    check(`reject bad prefix`, false, "should have thrown");
  } catch (e) {
    check(`reject bad prefix`, e instanceof TutkWyzeProtocolError);
  }
  try {
    // valid 16B header claiming txt_len=10, but body absent → length mismatch
    const truncated = encode(10000, Buffer.alloc(10)).subarray(0, 20);
    decode(truncated);
    check(`reject txt_len mismatch`, false, "should have thrown");
  } catch (e) {
    check(`reject txt_len mismatch`, e instanceof TutkWyzeProtocolError);
  }
}

// ---- 3. K-class encoding (every message produces parseable bytes) ------

section("K-class encoding (random sample)");
{
  // Pick a representative sample. Most produce a parseable header
  // + correct body length; a few we check specific bytes for.

  const samples = [
    {
      msg: new M.K10000ConnectRequest(null),
      assert: (buf) => buf.length === HEADER_SIZE,
      label: "K10000 (no mac, body-less)",
    },
    {
      msg: new M.K10000ConnectRequest("AA:BB:CC:DD:EE:FF"),
      assert: (buf) => buf.length > HEADER_SIZE
        && JSON.parse(buf.subarray(HEADER_SIZE).toString("utf8")).cameraInfo.wakeupFlag === 1,
      label: "K10000 (mac → JSON wake payload)",
    },
    {
      msg: new M.K10042SetNightVisionStatus(M.NV_AUTO),
      assert: (buf) => buf.length === HEADER_SIZE + 1 && buf[HEADER_SIZE] === 3,
      label: "K10042 night vision auto",
    },
    {
      msg: new M.K10072SetOSDStatus(M.OFF),
      assert: (buf) => buf.length === HEADER_SIZE + 1 && buf[HEADER_SIZE] === 2,
      label: "K10072 OSD off",
    },
    {
      msg: new M.K10092SetCameraTime(1700000000),
      assert: (buf) => buf.readUInt32LE(HEADER_SIZE) === 1700000000,
      label: "K10092 set time to 1700000000",
    },
    {
      msg: new M.K10052SetBitrate(BITRATE.HD),
      assert: (buf) => buf.readUInt16LE(HEADER_SIZE) === BITRATE.HD,
      label: "K10052 bitrate=HD",
    },
    {
      msg: new M.K10056SetResolvingBit(FRAME_SIZE.P1080, BITRATE.HD),
      assert: (buf) => buf[HEADER_SIZE] === FRAME_SIZE.P1080 + 1 && buf.readUInt16LE(HEADER_SIZE + 1) === BITRATE.HD,
      label: "K10056 resolving bit 1080p/HD",
    },
    {
      msg: new M.K10302SetTimeZone(-5),
      assert: (buf) => buf.readInt8(HEADER_SIZE) === -5,
      label: "K10302 timezone -5",
    },
    {
      msg: new M.K11000SetRotaryByDegree(45, -30, 5),
      assert: (buf) =>
        buf.readInt16LE(HEADER_SIZE) === 45 &&
        buf.readInt16LE(HEADER_SIZE + 2) === -30 &&
        buf.readUInt8(HEADER_SIZE + 4) === 5,
      label: "K11000 rotary by degree (45, -30, 5)",
    },
    {
      msg: new M.K11635ResponseQuickMessage(2),
      assert: (buf) => buf[HEADER_SIZE] === 2,
      label: "K11635 quick reply 'be there shortly'",
    },
  ];

  for (const { msg, assert, label } of samples) {
    const buf = msg.encode();
    // Every encoded message MUST be decodable.
    const { header } = decode(buf);
    check(`${label} — encodes + decodes`,
      header.prefix === "HL" && header.code === msg.code && assert(buf));
  }
}

// ---- 4. Response parsing -----------------------------------------------

section("Response parsing");
{
  // K10090 (camera time get) returns a uint32 LE timestamp
  const k10090 = new M.K10090GetCameraTime();
  const respBytes = Buffer.alloc(4);
  respBytes.writeUInt32LE(1700000000, 0);
  check(`K10090 parses uint32 timestamp`, k10090.parseResponse(respBytes) === 1700000000);

  // K10056 response 0x01 means success
  const k10056 = new M.K10056SetResolvingBit();
  check(`K10056 parses success 0x01`,
    k10056.parseResponse(Buffer.from([0x01])) === true);
  check(`K10056 parses failure 0x00`,
    k10056.parseResponse(Buffer.from([0x00])) === false);

  // K10446 parses JSON
  const k10446 = new M.K10446CheckConnStatus();
  const parsed = k10446.parseResponse(Buffer.from(JSON.stringify({ ok: true, level: 4 })));
  check(`K10446 parses JSON object`, parsed.ok === true && parsed.level === 4);
}

// ---- 5. XXTEA roundtrip in auth context --------------------------------

section("XXTEA + auth helper");
{
  // Use a fake enr + a fake challenge to exercise the helper. We can't
  // verify against a real camera response without one, but we can
  // confirm the math runs cleanly and produces a 16-byte output.
  const enr = "EXAMPLEENR123456"; // 16 ASCII chars
  const fakeChallenge = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) fakeChallenge[i] = i;

  const resp = auth.generateChallengeResponse(fakeChallenge, enr, 3);
  check(`challenge response is 16 bytes`, resp.length === 16);

  // Wrap into K10008 — the most common modern auth variant
  const k = new M.K10008ConnectUserAuth(resp, "myPhoneId123", "myOpenUserId987");
  const wire = k.encode();
  const { header } = decode(wire);
  check(`K10008 with computed response encodes cleanly`,
    header.code === 10008 && wire.length === HEADER_SIZE + header.txt_len);
}

// ---- 6. buildAuthResponse (full K10001 → auth flow) --------------------

section("buildAuthResponse (camera challenge → auth message)");
{
  // Simulated K10001 response: 1 status byte + 16 challenge bytes.
  // status=3 → standard auth path; product=WYZE_CAKP2JFUS → K10008 (default).
  const data = Buffer.concat([Buffer.from([3]), Buffer.alloc(16, 0xAA)]);
  const result = auth.buildAuthResponse({
    data,
    protocol: 5,
    enr: "MYCAMERAENR12345",
    productModel: "WYZE_CAKP2JFUS",
    mac: "AABBCCDDEEFF",
    phoneId: "phone1234",
    openUserId: "user5678",
  });
  check(`returns K10008 for V3 camera`, result instanceof M.K10008ConnectUserAuth);
  check(`encodes cleanly`, result.encode().length > HEADER_SIZE);

  // Doorbell → K10006 path
  const result2 = auth.buildAuthResponse({
    data,
    protocol: 5,
    enr: "DOORBELLENR12345",
    productModel: "WYZEDB3",
    mac: "DBDBDBDBDBDB",
    phoneId: "phone1234",
    openUserId: "user5678",
  });
  check(`returns K10006 for doorbell`, result2 instanceof M.K10006ConnectUserAuth);

  // Camera-busy status (2 = updating) → returns busyReason marker, not a message
  const busy = auth.buildAuthResponse({
    data: Buffer.concat([Buffer.from([2]), Buffer.alloc(16)]),
    protocol: 5,
    enr: "x",
    productModel: "WYZE_CAKP2JFUS",
    mac: "x",
    phoneId: "x",
    openUserId: "x",
  });
  check(`returns busyReason for status=2 (updating)`,
    busy && busy.busyReason === "updating");
}

// ---- 7. Performance ----------------------------------------------------

section("Performance");
{
  const N = 10_000;
  const buildMs = timed(() => {
    for (let i = 0; i < N; i++) new M.K10042SetNightVisionStatus(3).encode();
  });
  const oneMsg = new M.K10042SetNightVisionStatus(3).encode();
  const parseMs = timed(() => {
    for (let i = 0; i < N; i++) decode(oneMsg);
  });
  const xxteaMs = timed(() => {
    const k = Buffer.from("0123456789ABCDEF", "ascii");
    const d = Buffer.alloc(16, 0x11);
    for (let i = 0; i < N; i++) xxtea.encrypt(d, k);
  });
  console.log(`  build:        ${buildMs.toFixed(1)}ms / ${N} (${(N/buildMs*1000).toFixed(0)}/s)`);
  console.log(`  decode:       ${parseMs.toFixed(1)}ms / ${N} (${(N/parseMs*1000).toFixed(0)}/s)`);
  console.log(`  xxtea-16B enc: ${xxteaMs.toFixed(1)}ms / ${N} (${(N/xxteaMs*1000).toFixed(0)}/s)`);
  check(`build > 10k/s`, N / buildMs * 1000 > 10_000);
  check(`decode > 10k/s`, N / parseMs * 1000 > 10_000);
}

// ---- Summary -----------------------------------------------------------

console.log();
if (failures === 0) {
  console.log("ALL GREEN — Tutk Phase 0 protocol layer is sound.");
  console.log("");
  console.log("Next steps:");
  console.log("  • Capture real IOCtrl bytes from a Wyze camera session and");
  console.log("    feed them through decode() to validate against hardware.");
  console.log("  • Phase 1: koffi loader for libIOTCAPIs_ALL.so + Bionic shim");
  console.log("    (Linux only) to actually establish IOTC sessions.");
  console.log("  • Phase 2.5: wire K10000+ commands into wyze-api's cameras");
  console.log("    helpers so the bridge uses local Tutk control instead of");
  console.log("    cloud HTTP (sub-second device toggles).");
  process.exit(0);
} else {
  console.log(`FAILED — ${failures} check(s) failed.`);
  process.exit(1);
}
