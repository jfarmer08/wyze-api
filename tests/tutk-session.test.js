/**
 * Tutk session tests — runs everywhere via a fake SDK stub.
 *
 * The session layer's logic (auth flow, send/receive matching, timeout
 * handling, lifecycle) can be tested without the real `.so` by injecting
 * a stub that mimics the koffi binding surface. This catches logic bugs
 * before they hit hardware.
 *
 * Anything that genuinely needs the binary (struct ABI, network I/O)
 * is covered by the Linux smoke test.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

// We don't actually load the real loader; we use the internal SDK
// ref-count + a stub that mimics its surface.
const sessionMod = require("../src/tutk/session");
const { TutkSession, TutkSessionError, SessionClosedError } = sessionMod;

const codec = require("../src/tutk/lib/codec");
const M = require("../src/tutk/lib/messages");
const auth = require("../src/tutk/lib/auth");
const xxtea = require("../src/tutk/lib/xxtea");

// ---- A stub SDK that simulates a camera --------------------------------
//
// Maintains an in-memory queue of "responses the camera will send next".
// Sends from the session land in `sent`; receives drain from `responses`.
// This is enough to exercise auth + send/receive matching end-to-end.

function makeStubSdk(camResponses = []) {
  const sent = [];
  const responses = [...camResponses]; // pre-queued camera responses
  let sessionIdSeq = 100;
  let chanIdSeq = 1;

  return {
    sent,
    responses,
    sdk: {
      getVersionString: () => "STUB 4.0.0",
      iotcInitialize2: (_port) => 0,
      iotcDeInitialize: () => 0,
      // Sync + async variants — production code calls *Async, but the
      // sync ones are retained on the SDK surface, so we stub both.
      connectByUid: (_uid) => sessionIdSeq++,
      connectByUidAsync: (_uid) => Promise.resolve(sessionIdSeq++),
      sessionClose: (_sid) => {},
      avInitialize: (_n) => 8,
      avDeInitialize: () => 0,
      avClientStartEx: (_args) => ({ chanId: chanIdSeq, out: { server_type: 0 } }),
      avClientStartExAsync: (_args) =>
        Promise.resolve({ chanId: chanIdSeq++, out: { server_type: 0 } }),
      avClientStop: (_c) => {},
      avSendIoCtrlExit: (_c) => {},
      avSendIoCtrl: (_chan, _type, data) => {
        sent.push(Buffer.from(data));
        return 0;
      },
      avRecvIoCtrl: (_chan, _timeout) => {
        if (responses.length === 0) return { errno: -20015 }; // AV_ER_DATA_NOREADY
        return { ctrlType: 0, data: responses.shift() };
      },
      raw: {},
    },
  };
}

/**
 * Wire the stub by replacing the loader-acquire path inside session.js.
 * We use require's cache to patch `loader.js` -> our stub before each
 * test that exercises a session.
 */
function withStubSdk(camResponses, fn) {
  const stub = makeStubSdk(camResponses);
  const loaderPath = require.resolve("../src/tutk/loader");
  const origLoader = require.cache[loaderPath]
    ? require.cache[loaderPath].exports
    : require("../src/tutk/loader");

  // Re-export the stubbed surface.
  require.cache[loaderPath] = {
    exports: {
      ...origLoader,
      loadTutk: () => stub.sdk,
      isTutkSupported: () => ({ supported: true, platform: "linux", arch: "x64" }),
    },
  };
  // Force session.js to pick up the stubbed loader.
  delete require.cache[require.resolve("../src/tutk/session")];
  const reloadedSession = require("../src/tutk/session");

  // Reset the SDK ref-count so successive tests don't reuse a stale SDK.
  reloadedSession._internal._releaseSdk();
  reloadedSession._internal._releaseSdk();
  reloadedSession._internal._releaseSdk();

  return Promise.resolve(fn(reloadedSession, stub)).finally(() => {
    require.cache[loaderPath].exports = origLoader;
    delete require.cache[require.resolve("../src/tutk/session")];
  });
}

// ---- Build a synthetic camera K10001 response --------------------------

function buildK10001Response(enr) {
  // Payload: 1B status (3 = standard) + 16B challenge bytes.
  // We use the same enr + a known challenge so we can predict the K10003.
  const payload = Buffer.alloc(17);
  payload[0] = 3;
  for (let i = 0; i < 16; i++) payload[i + 1] = i;
  // Wrap in a Tutk header for code 10001.
  return codec.encode(10001, payload);
}

function buildK10009Response(body) {
  // Camera auth-OK response: JSON body for K10008's response code 10009.
  const json = Buffer.from(JSON.stringify(body || { connectionRes: "1" }));
  return codec.encode(10009, json);
}

// ---- Tests -------------------------------------------------------------

test("connect() establishes session + completes auth via stub", async () => {
  const enr = "EXAMPLEENR123456";
  const queue = [
    buildK10001Response(enr),
    buildK10009Response({ connectionRes: "1", role: "client" }),
  ];

  await withStubSdk(queue, async ({ TutkSession }, stub) => {
    const s = new TutkSession({
      uid: "AABBCCDDEEFF",
      enr,
      productModel: "WYZE_CAKP2JFUS",
      mac: "AABBCCDDEEFF",
      phoneId: "phone1234",
      openUserId: "user5678",
    });
    try {
      await s.connect();
      assert.strictEqual(s.state, "authed");

      // Two messages should have been sent: K10000 then K10008
      assert.strictEqual(stub.sent.length, 2);
      const first = codec.decode(stub.sent[0]);
      assert.strictEqual(first.header.code, 10000);
      const second = codec.decode(stub.sent[1]);
      assert.strictEqual(second.header.code, 10008);

      // Verify the K10008 carries the correct xxtea response.
      // First 16 bytes of the K10008 body == decrypted challenge.
      const expectedResp = auth.generateChallengeResponse(
        Buffer.from(Array(16).fill(0).map((_, i) => i)),
        enr, 3
      );
      assert.ok(second.payload.subarray(0, 16).equals(expectedResp));
    } finally {
      // Always close — without this, the setInterval receive pump
      // keeps the event loop alive and the test runner hangs.
      await s.close();
    }
    assert.strictEqual(s.state, "closed");
  });
});

test("send() round-trips a K-class request → response", async () => {
  const enr = "EXAMPLEENR123456";
  const k10091 = codec.encode(10091, Buffer.from([0x00, 0xf1, 0x53, 0x65])); // 1700000000 LE
  const queue = [
    buildK10001Response(enr),
    buildK10009Response(),
    k10091,
  ];

  await withStubSdk(queue, async ({ TutkSession }, stub) => {
    const s = new TutkSession({
      uid: "X",
      enr,
      productModel: "WYZE_CAKP2JFUS",
      mac: "X",
      phoneId: "p",
      openUserId: "u",
    });
    try {
      await s.connect();
      const time = await s.send(new M.K10090GetCameraTime(), 2000);
      assert.strictEqual(time, 1700000000);
    } finally {
      await s.close();
    }
  });
});

test("send() rejects with timeout when no matching response arrives", async () => {
  const enr = "EXAMPLEENR123456";
  // Queue only enough to authenticate — no K10091 for K10090
  const queue = [
    buildK10001Response(enr),
    buildK10009Response(),
  ];

  await withStubSdk(queue, async (reloaded, stub) => {
    const s = new reloaded.TutkSession({
      uid: "X", enr, productModel: "WYZE_CAKP2JFUS",
      mac: "X", phoneId: "p", openUserId: "u",
    });
    try {
      await s.connect();
      await assert.rejects(
        s.send(new M.K10090GetCameraTime(), 200),
        // Check by name not instanceof — withStubSdk reloads session.js,
        // which creates a *different* TutkSessionError class than the
        // one in this file's top-level import. Same shape, different
        // identity, so instanceof fails.
        (err) => err.name === "TutkSessionError" && /Timed out/.test(err.message)
      );
    } finally {
      await s.close();
    }
  });
});

test("close() rejects pending sends with SessionClosedError", async () => {
  const enr = "EXAMPLEENR123456";
  const queue = [
    buildK10001Response(enr),
    buildK10009Response(),
  ];

  await withStubSdk(queue, async (reloaded, stub) => {
    const s = new reloaded.TutkSession({
      uid: "X", enr, productModel: "WYZE_CAKP2JFUS",
      mac: "X", phoneId: "p", openUserId: "u",
    });
    try {
      await s.connect();
      const pending = s.send(new M.K10090GetCameraTime(), 5000);
      await s.close();
      // Check by name (see above re: instanceof + reloaded module).
      await assert.rejects(pending, (err) => err.name === "SessionClosedError");
    } finally {
      // close() is idempotent — second call is a no-op.
      await s.close();
    }
  });
});

test("connect() reports IOTC error code on failure", async () => {
  const stub = makeStubSdk([]);
  stub.sdk.connectByUidAsync = () => Promise.resolve(-3); // simulate IOTC_ER_NETWORK_UNREACHABLE
  const loaderPath = require.resolve("../src/tutk/loader");
  const orig = require.cache[loaderPath].exports;
  require.cache[loaderPath] = {
    exports: {
      ...orig,
      loadTutk: () => stub.sdk,
      isTutkSupported: () => ({ supported: true, platform: "linux", arch: "x64" }),
    },
  };
  delete require.cache[require.resolve("../src/tutk/session")];
  const { TutkSession: T, TutkSessionError: E, _internal } = require("../src/tutk/session");
  _internal._releaseSdk();
  _internal._releaseSdk();
  try {
    const s = new T({
      uid: "X", enr: "x", productModel: "X",
      mac: "X", phoneId: "p", openUserId: "u",
    });
    await assert.rejects(
      s.connect(),
      (err) => err instanceof E && err.code === -3 && /returned -3/.test(err.message)
    );
  } finally {
    require.cache[loaderPath].exports = orig;
    delete require.cache[require.resolve("../src/tutk/session")];
  }
});
