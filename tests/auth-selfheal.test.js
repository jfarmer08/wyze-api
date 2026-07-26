/**
 * Access-token error recovery — no network, no real auth.
 *
 * Regression coverage for homebridge-wyze-smart-home#306: a stale/invalid
 * persisted token pair must not wedge the client. When the refresh token can no
 * longer obtain a new access token, the persisted token file is discarded and a
 * full credential login is attempted so the client self-heals.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WyzeAPI = require("../src/index");

const noop = () => {};
function stub() {
  const w = Object.create(WyzeAPI.prototype);
  w.log = { info: noop, error: noop };
  w.apiLogEnabled = false;
  w.access_token = "";
  w.refresh_token = "";
  return w;
}

const result = { data: { code: 2001, msg: "access token is error" } };

test("_handleAccessTokenError: refresh success does not force a full login", async () => {
  const w = stub();
  let refreshed = false, cleared = false, loggedIn = false;
  w.refreshToken = async () => { refreshed = true; w.access_token = "REFRESHED"; };
  w._clearPersistedTokens = async () => { cleared = true; };
  w.login = async () => { loggedIn = true; };

  const out = await w._handleAccessTokenError(result, "access token is error", 2001, "some/url", {});

  assert.strictEqual(refreshed, true, "should attempt a refresh");
  assert.strictEqual(cleared, false, "should not discard tokens on the fast path");
  assert.strictEqual(loggedIn, false, "should not fall back to a full login");
  assert.ok(out.error.retryAfter, "should signal the request can be retried");
});

test("_handleAccessTokenError: refresh failure discards tokens and re-logs in", async () => {
  const w = stub();
  w.refresh_token = "STALE";
  let cleared = false, loggedIn = false;
  w.refreshToken = async () => { throw new Error("refresh rejected"); };
  w._clearPersistedTokens = async () => { cleared = true; };
  w.login = async () => {
    assert.strictEqual(w.access_token, "", "access token should be cleared before re-login");
    loggedIn = true;
    w.access_token = "NEW";
  };

  const out = await w._handleAccessTokenError(result, "access token is error", 2001, "some/url", {});

  assert.strictEqual(cleared, true, "should discard the poisoned persisted tokens");
  assert.strictEqual(loggedIn, true, "should perform a full login");
  assert.strictEqual(w.refresh_token, "", "should clear the stale refresh token before re-login");
  assert.ok(out.error.retryAfter, "should signal the request can be retried after re-login");
});

test("_handleAccessTokenError: end-to-end deletes the poisoned file on disk (issue #306)", async () => {
  const w = stub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wyze-e2e-"));
  const tokenPath = path.join(dir, "wyze-token.json");
  w._tokenPersistPath = () => tokenPath;
  fs.writeFileSync(tokenPath, JSON.stringify({ access_token: "STALE", refresh_token: "STALE" }));
  w.refresh_token = "STALE";

  // Use the REAL _clearPersistedTokens (inherited) to prove the handler and the
  // file deletion connect: poisoned file on disk -> handler -> file gone.
  w.refreshToken = async () => { throw new Error("refresh rejected"); };
  let loggedIn = false;
  w.login = async () => { loggedIn = true; w.access_token = "NEW"; };

  const out = await w._handleAccessTokenError(result, "access token is error", 2001, "some/url", {});

  assert.strictEqual(fs.existsSync(tokenPath), false, "poisoned token file must be removed from disk");
  assert.strictEqual(loggedIn, true, "should perform a full login after clearing the file");
  assert.ok(out.error.retryAfter, "should signal the request can be retried");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("_handleAccessTokenError: refresh and re-login both fail returns a terminal error", async () => {
  const w = stub();
  let cleared = false;
  w.refreshToken = async () => { throw new Error("refresh rejected"); };
  w._clearPersistedTokens = async () => { cleared = true; };
  w.login = async () => { throw new Error("bad credentials"); };

  const out = await w._handleAccessTokenError(result, "access token is error", 2001, "some/url", {});

  assert.strictEqual(cleared, true, "should still discard the poisoned tokens");
  assert.strictEqual(out.error.retryAfter, 0, "should not ask the caller to retry");
  assert.match(out.error.message, /Re-login failed/);
});

test("_clearPersistedTokens: removes the file and is safe when absent", async () => {
  const w = stub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wyze-clear-"));
  const tokenPath = path.join(dir, "wyze-token.json");
  w._tokenPersistPath = () => tokenPath;

  fs.writeFileSync(tokenPath, JSON.stringify({ access_token: "a", refresh_token: "b" }));
  await w._clearPersistedTokens();
  assert.strictEqual(fs.existsSync(tokenPath), false, "should delete the token file");

  // Calling again with no file present must not throw (ENOENT is treated as success).
  await assert.doesNotReject(() => w._clearPersistedTokens());

  fs.rmSync(dir, { recursive: true, force: true });
});

test("_clearPersistedTokens: swallows non-ENOENT errors", async () => {
  const w = stub();
  // Point at a directory: unlink() on a directory throws EPERM/EISDIR (not
  // ENOENT), which the defensive branch logs and swallows rather than rejects.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wyze-eperm-"));
  w._tokenPersistPath = () => dir;

  await assert.doesNotReject(() => w._clearPersistedTokens());

  fs.rmSync(dir, { recursive: true, force: true });
});
