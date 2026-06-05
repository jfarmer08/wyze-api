/**
 * Tutk loader tests — runs everywhere (macOS / Windows / Linux).
 *
 * These tests validate the parts of the Tutk loader that DON'T need
 * the actual `.so` to be present:
 *   - Platform detection (isTutkSupported)
 *   - Default path resolution
 *   - Refusal modes (missing .so, wrong arch, unsupported platform)
 *   - Loader-error shapes
 *
 * Anything that requires the .so itself is covered by a separate
 * Linux-only smoke test (tests/tutk-load-real.smoke.js, not run by
 * the default `npm test` because it depends on the binary being
 * fetched ahead of time).
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const {
  isTutkSupported,
  defaultSoPath,
  loadTutk,
  TutkLoaderError,
} = require("../src/tutk/loader");

test("isTutkSupported returns object with platform + arch", () => {
  const r = isTutkSupported();
  assert.strictEqual(typeof r, "object");
  assert.strictEqual(typeof r.supported, "boolean");
  assert.strictEqual(r.platform, os.platform());
  assert.strictEqual(r.arch, os.arch());
});

test("isTutkSupported refuses macOS / Windows with reason", () => {
  const r = isTutkSupported();
  if (r.platform === "darwin" || r.platform === "win32") {
    assert.strictEqual(r.supported, false);
    assert.ok(r.reason && r.reason.includes("Tutk requires Linux"));
  }
});

test("defaultSoPath points under ~/.homebridge/wyze-sdk/", () => {
  const p = defaultSoPath();
  assert.ok(p.endsWith(path.join(".homebridge", "wyze-sdk", "libIOTCAPIs_ALL.so")),
    `unexpected default: ${p}`);
  assert.ok(p.startsWith(os.homedir()), `default not under HOME: ${p}`);
});

test("loadTutk throws TutkLoaderError on non-Linux", { skip: os.platform() === "linux" }, () => {
  assert.throws(
    () => loadTutk(),
    (err) => err instanceof TutkLoaderError && /not supported|requires Linux/.test(err.message)
  );
});

test("loadTutk throws when .so file is missing (Linux)",
  { skip: os.platform() !== "linux" },
  () => {
    const bogusPath = "/tmp/definitely-does-not-exist-libIOTCAPIs_ALL.so";
    // Make sure it really doesn't exist
    try { fs.unlinkSync(bogusPath); } catch (_) {}
    assert.throws(
      () => loadTutk(bogusPath),
      (err) =>
        err instanceof TutkLoaderError &&
        err.message.includes("not found") &&
        err.message.includes(bogusPath)
    );
  });

test("TutkLoaderError preserves message and optional cause", () => {
  const original = new Error("inner");
  const err = new TutkLoaderError("outer", original);
  assert.strictEqual(err.name, "TutkLoaderError");
  assert.strictEqual(err.message, "outer");
  assert.strictEqual(err.cause, original);
});
