#!/usr/bin/env node
"use strict";

/**
 * spike.js — exercise the JS GUTES protocol primitives end-to-end.
 *
 * This is the Phase 0 dev script. It does NOT talk to any real
 * hardware (that's Phase 1+ work). Instead it:
 *
 *   1. Builds frames using our builders
 *   2. Parses them back with our parser
 *   3. Cross-checks the RC5 / crypto primitives
 *   4. Reports timing on a typical workflow
 *
 * If this prints "ALL GREEN", the pure-JS protocol layer is sound and
 * we're ready to attempt session establishment against real hardware
 * in Phase 1 (which needs UDP networking, .so loading, etc.).
 *
 * USAGE
 *   node spike.js
 *
 * EXIT
 *   0 on success, 1 on any check failure.
 */

const { RC5, GWELL_KEY, derivePerFrameKey, idEncrypt, idDecrypt } = require("./lib/rc5");
const { TYPES, PROTOCOL, HEADER_SIZE, frameTypeName } = require("./lib/constants");
const { parseFrame, readFrameFromStream } = require("./lib/frame");
const {
  giotHashString,
  extractRequestSequenceNumber,
  verifySessionKey,
  extractServerKeyFromCertifyResp,
} = require("./lib/session-crypto");
const {
  nextSqnum,
  makeServerChkval,
  encryptServerId,
  computeChkval,
  buildKeepalive,
  buildKeepaliveAck,
} = require("./lib/builders");

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ns = Number(process.hrtime.bigint() - t0);
  return { out, ms: ns / 1e6 };
}

// ---- 1. RC5 sanity ------------------------------------------------------

section("RC5 primitives");
{
  const rc5 = new RC5({ blockBytes: 8, rounds: 6 }).setKey(GWELL_KEY);
  const pt = Buffer.from("ABCDEFGH");
  const ct = rc5.encryptBlock(pt);
  const back = rc5.decryptBlock(ct);
  check(`RC5-8B round-trip with Gwell key`, back.equals(pt));

  const rc5_16 = new RC5({ blockBytes: 16, rounds: 6 }).setKey(Buffer.alloc(16, 0xAB));
  const pt16 = Buffer.from("1234567890ABCDEF");
  const ct16 = rc5_16.encryptBlock(pt16);
  const back16 = rc5_16.decryptBlock(ct16);
  check(`RC5-16B round-trip with arbitrary key`, back16.equals(pt16));
}

// ---- 2. ID encryption / decryption round-trip --------------------------

section("Frame ID encryption");
{
  const termId = Buffer.alloc(8);
  termId.writeBigInt64LE(0x0123456789ABCDEFn, 0);
  const sq = Buffer.alloc(4);
  sq.writeUInt32LE(0xCAFEBABE, 0);
  const chk = Buffer.alloc(4);
  chk.writeUInt32LE(0xDEADBEEF, 0);
  const enc = idEncrypt(termId, chk, sq);
  const dec = idDecrypt(enc, chk, sq);
  check(`encrypt → decrypt round-trip`, dec.equals(termId));
}

// ---- 3. Frame builders + parser round-trip ------------------------------

section("Frame round-trip (KEEPALIVE + ACK)");
{
  const state = { server_term_id: 0xDEADBEEFCAFE0042n, server_sqnum: 7, t0: 0 };
  const ka = buildKeepalive(state);
  const parsed = parseFrame(ka, { direction: "C->S" });
  check(`KEEPALIVE parses`, parsed !== null);
  check(`KEEPALIVE has correct type`, parsed.frameType === TYPES.KEEPALIVE);
  // parsed.termId is signed (readBigInt64LE); compare via unsigned mask
  // so values >= 2^63 round-trip correctly. The bytes are identical
  // either way — only the JS view differs.
  check(`KEEPALIVE term_id decrypts back`,
    BigInt.asUintN(64, parsed.termId) === BigInt.asUintN(64, state.server_term_id));
  check(`KEEPALIVE sqnum preserved`, parsed.sqnum === 7);
  check(`KEEPALIVE state advanced (sqnum=8)`, state.server_sqnum === 8);

  // ACK round-trip
  const ackState = { server_term_id: 0xAAAAAAAAAAAAAAAAn, server_sqnum: 0, t0: 0 };
  const ack = buildKeepaliveAck(ackState, ka);
  const parsedAck = parseFrame(ack, { direction: "S->C" });
  check(`ACK parses`, parsedAck !== null);
  check(`ACK echoes inbound sqnum`, parsedAck.sqnum === 7);
  check(`ACK marks opt_ack=1`, parsedAck.isAck);
}

// ---- 4. Stream-mode parser handles garbage prefix ----------------------

section("Stream-mode parser (TCP-style framing)");
{
  const state = { server_term_id: 1n, server_sqnum: 0, t0: 0 };
  const real = buildKeepalive(state);
  const stream = Buffer.concat([Buffer.from([0xFF, 0x00, 0xAB]), real, Buffer.from([0xFF])]);
  const r1 = readFrameFromStream(stream);
  check(`stream skips garbage prefix`, r1 && r1.frame === null && r1.consumed === 3);
  const r2 = readFrameFromStream(stream.subarray(r1.consumed));
  check(`stream extracts frame after skip`, r2 && r2.frame !== null);
  check(`stream consumed exactly one frame`, r2 && r2.consumed === HEADER_SIZE);
}

// ---- 5. Session crypto -------------------------------------------------

section("Session crypto");
{
  check(`giotHashString("") = 0x4e67c6a7`, giotHashString(Buffer.alloc(0)) === 0x4E67C6A7);
  check(`giotHashString("hello") deterministic`,
    giotHashString(Buffer.from("hello")) === giotHashString(Buffer.from("hello")));
  check(`verifySessionKey rejects all-zero`,
    verifySessionKey(Buffer.alloc(32)) === false);
  check(`verifySessionKey accepts random-looking`,
    verifySessionKey(Buffer.from("0102030405060708090A0B0C0D0E0F1011121314151617181920212223242526", "hex")) === true);

  // Plaintext sqnum extraction
  const state = { server_term_id: 1n, server_sqnum: 999, t0: 0 };
  const ka = buildKeepalive(state);
  // We built it with qos=1 (no encryption), so plain readUInt32LE works
  const sqExtracted = extractRequestSequenceNumber(ka);
  check(`extract sqnum from plaintext KEEPALIVE`, sqExtracted === 999);
}

// ---- 6. computeChkval consistency --------------------------------------

section("Frame checksum");
{
  // Build any payload-bearing frame and confirm computeChkval is stable.
  const frame = Buffer.alloc(0x40);
  frame[0] = PROTOCOL.RELAY;
  frame[1] = TYPES.CERTIFY_REQ;
  frame.writeUInt16LE(0x40, 2);
  frame.writeBigUInt64LE(0x0807060504030201n, 4);
  frame.writeUInt32LE(123, 0x0C);
  // chkval (offset 0x10) is intentionally excluded from the calculation
  frame.writeUInt32LE(0xFFFFFFFF, 0x10); // any value — should be ignored
  frame.writeUInt32LE(0x00010000, 0x14);
  for (let i = 0x1C; i < 0x40; i++) frame[i] = i;

  const c1 = computeChkval(frame);
  frame.writeUInt32LE(0x12345678, 0x10); // change chkval field
  const c2 = computeChkval(frame);
  check(`computeChkval ignores chkval field`, c1 === c2);

  // Changing any non-chkval byte changes the result.
  frame[0x1C] = 0xFF;
  const c3 = computeChkval(frame);
  check(`computeChkval depends on payload bytes`, c3 !== c1);
}

// ---- 7. Timing — 10k frames round-tripped ------------------------------

section("Performance");
{
  const state = { server_term_id: 1n, server_sqnum: 0, t0: 0 };
  const N = 10_000;
  const { ms: buildMs } = timed(() => {
    for (let i = 0; i < N; i++) buildKeepalive(state);
  });
  const oneFrame = buildKeepalive({ server_term_id: 1n, server_sqnum: 0, t0: 0 });
  const { ms: parseMs } = timed(() => {
    for (let i = 0; i < N; i++) parseFrame(oneFrame);
  });
  console.log(`  build:  ${buildMs.toFixed(1)}ms for ${N} frames (${(N/buildMs*1000).toFixed(0)}/s)`);
  console.log(`  parse:  ${parseMs.toFixed(1)}ms for ${N} frames (${(N/parseMs*1000).toFixed(0)}/s)`);
  check(`build > 5k frames/sec`, N / buildMs * 1000 > 5000);
  check(`parse > 5k frames/sec`, N / parseMs * 1000 > 5000);
}

// ---- Summary -----------------------------------------------------------

console.log();
if (failures === 0) {
  console.log("ALL GREEN — Phase 0 protocol layer is sound.");
  console.log("");
  console.log("Next steps:");
  console.log("  • Capture real device traffic and run parse-pcap.js on it");
  console.log("    to validate against bytes from your hardware.");
  console.log("  • Phase 1: build the koffi loader + Bionic shim for the .so");
  console.log("    once we have a tested protocol foundation.");
  process.exit(0);
} else {
  console.log(`FAILED — ${failures} check(s) failed. Fix before proceeding.`);
  process.exit(1);
}
