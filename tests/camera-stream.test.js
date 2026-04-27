/**
 * Stream-related helpers: URL/ICE/status normalization, client-ID generation,
 * cache key, signature determinism, and the cache behavior of
 * getCameraWebRTCConnectionInfo (with cameraGetStreamInfo stubbed out).
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");
const cryptoHelpers = require("../src/utils/crypto");

const stub = () => Object.create(WyzeAPI.prototype);

test("normalizeCameraSignalingUrl", async (t) => {
  const w = stub();

  await t.test("decodes one pass of percent-encoding when %25 is present", () => {
    // The helper only does a single decodeURIComponent pass — `%253D` (a
    // double-encoded `=`) becomes `%3D` (single-encoded), which is what
    // URL parsers handle natively. We don't want to fully unescape and
    // break a legitimately-encoded query string.
    assert.strictEqual(
      w.normalizeCameraSignalingUrl("wss://example.com/?a%253Db"),
      "wss://example.com/?a%3Db"
    );
  });

  await t.test("leaves single-encoded URLs alone", () => {
    const url = "wss://example.com/?a=b&c=d";
    assert.strictEqual(w.normalizeCameraSignalingUrl(url), url);
  });

  await t.test("handles empty / null", () => {
    assert.strictEqual(w.normalizeCameraSignalingUrl(""), "");
    assert.strictEqual(w.normalizeCameraSignalingUrl(null), null);
    assert.strictEqual(w.normalizeCameraSignalingUrl(undefined), undefined);
  });
});

test("sanitizeCameraIceServers", async (t) => {
  const w = stub();

  await t.test("renames `url` to `urls` and preserves credentials", () => {
    assert.deepStrictEqual(
      w.sanitizeCameraIceServers([
        { url: "turn:foo:443", username: "u", credential: "c" },
        { url: "stun:bar:443" },
      ]),
      [
        { urls: "turn:foo:443", username: "u", credential: "c" },
        { urls: "stun:bar:443" },
      ]
    );
  });

  await t.test("drops malformed entries", () => {
    assert.deepStrictEqual(
      w.sanitizeCameraIceServers([
        { url: "" },
        null,
        undefined,
        { username: "no-url" },
        { url: "stun:keep" },
      ]),
      [{ urls: "stun:keep" }]
    );
  });

  await t.test("returns empty array for empty/missing input", () => {
    assert.deepStrictEqual(w.sanitizeCameraIceServers([]), []);
    assert.deepStrictEqual(w.sanitizeCameraIceServers(), []);
  });

  await t.test("omits empty username/credential", () => {
    assert.deepStrictEqual(
      w.sanitizeCameraIceServers([{ url: "stun:x", username: "", credential: "" }]),
      [{ urls: "stun:x" }]
    );
  });
});

test("parseCameraStatus", async (t) => {
  const w = stub();

  await t.test("returns online/powered for well-formed response", () => {
    assert.deepStrictEqual(
      w.parseCameraStatus({
        data: [
          { property: { "iot-device::iot-state": 1, "iot-device::iot-power": 1 } },
        ],
      }),
      { online: true, powered: true }
    );
  });

  await t.test("flags offline / off correctly", () => {
    assert.deepStrictEqual(
      w.parseCameraStatus({
        data: [
          { property: { "iot-device::iot-state": 0, "iot-device::iot-power": 1 } },
        ],
      }),
      { online: false, powered: true }
    );
    assert.deepStrictEqual(
      w.parseCameraStatus({
        data: [
          { property: { "iot-device::iot-state": 1, "iot-device::iot-power": 0 } },
        ],
      }),
      { online: true, powered: false }
    );
  });

  await t.test("returns null for malformed input", () => {
    assert.strictEqual(w.parseCameraStatus(null), null);
    assert.strictEqual(w.parseCameraStatus({}), null);
    assert.strictEqual(w.parseCameraStatus({ data: [] }), null);
    assert.strictEqual(w.parseCameraStatus({ data: [{}] }), null);
  });
});

test("createCameraStreamClientId", async (t) => {
  const w = stub();

  await t.test("uses last 8 chars of MAC, lowercased, alphanum-only", () => {
    const id = w.createCameraStreamClientId("AA:BB:CC:DD:EE:FF", "test");
    assert.match(id, /^test-ccddeeff-\d+-[a-f0-9]{8}$/);
  });

  await t.test("accepts a device object", () => {
    const id = w.createCameraStreamClientId({ mac: "AA:BB:CC:DD:EE:FF" });
    assert.match(id, /^viewer-ccddeeff-\d+-[a-f0-9]{8}$/);
  });

  await t.test("falls back to 'camera' slug when mac missing", () => {
    const id = w.createCameraStreamClientId(null);
    assert.match(id, /^viewer-camera-\d+-[a-f0-9]{8}$/);
  });

  await t.test("sanitizes prefix", () => {
    const id = w.createCameraStreamClientId("AA", "ho me/bridge");
    assert.match(id, /^ho-me-bridge-/);
  });

  await t.test("two consecutive ids differ", () => {
    const a = w.createCameraStreamClientId("AA");
    const b = w.createCameraStreamClientId("AA");
    assert.notStrictEqual(a, b);
  });
});

test("_streamCacheKey format is stable", () => {
  const w = stub();
  assert.strictEqual(
    w._streamCacheKey("AA:BB", "WYZE_CAKP", false),
    "AA:BB:WYZE_CAKP:main"
  );
  assert.strictEqual(
    w._streamCacheKey("AA:BB", "WYZE_CAKP", true),
    "AA:BB:WYZE_CAKP:sub"
  );
});

test("web_create_signature is deterministic", () => {
  // Reference value computed from the equivalent Python implementation
  // (wyzeapy PR #230). If the algorithm changes, this catches it.
  assert.strictEqual(
    cryptoHelpers.web_create_signature("identical_body_for_test", "fake_token"),
    "f28a8dbc5a38670bcbc26ac82c6b9a99"
  );
});

test("web_create_signature handles object payload via sorted form-encoding", () => {
  // Object input is serialized as sorted "k=v&k=v" — this exercises the
  // non-string branch of the helper.
  const sig = cryptoHelpers.web_create_signature({ b: 2, a: 1 }, "token");
  // Same input, deterministic output
  assert.strictEqual(
    sig,
    cryptoHelpers.web_create_signature({ a: 1, b: 2 }, "token")
  );
});

test("getCameraWebRTCConnectionInfo: cache + sanitization", async (t) => {
  const baseInfo = {
    signaling_url: "wss://kvs/?a%253Db",
    ice_servers: [
      { url: "turn:foo:443", username: "u", credential: "c" },
      { url: "stun:bar:443" },
    ],
    auth_token: "TOKEN",
  };

  await t.test("first call fetches; second call (within TTL) is cached", async () => {
    const w = stub();
    let calls = 0;
    w.cameraGetStreamInfo = async () => {
      calls += 1;
      return baseInfo;
    };

    const r1 = await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    assert.strictEqual(calls, 1);
    assert.strictEqual(r1.cached, false);

    const r2 = await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    assert.strictEqual(calls, 1, "second call should hit cache");
    assert.strictEqual(r2.cached, true);
  });

  await t.test("noCache: true bypasses cache", async () => {
    const w = stub();
    let calls = 0;
    w.cameraGetStreamInfo = async () => {
      calls += 1;
      return baseInfo;
    };

    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    await w.getCameraWebRTCConnectionInfo("AA", "MODEL", { noCache: true });
    assert.strictEqual(calls, 2);
  });

  await t.test("substream uses a separate cache slot", async () => {
    const w = stub();
    let calls = 0;
    w.cameraGetStreamInfo = async () => {
      calls += 1;
      return baseInfo;
    };

    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    await w.getCameraWebRTCConnectionInfo("AA", "MODEL", { substream: true });
    assert.strictEqual(calls, 2, "main and sub streams cache separately");
  });

  await t.test("sanitizes ICE, normalizes URL, exposes authToken", async () => {
    const w = stub();
    w.cameraGetStreamInfo = async () => baseInfo;

    const r = await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    assert.strictEqual(r.signalingUrl, "wss://kvs/?a%3Db", "URL decoded one pass");
    assert.deepStrictEqual(r.iceServers, [
      { urls: "turn:foo:443", username: "u", credential: "c" },
      { urls: "stun:bar:443" },
    ]);
    assert.strictEqual(r.authToken, "TOKEN");
    assert.strictEqual(r.mac, "AA");
    assert.strictEqual(r.model, "MODEL");
    assert.strictEqual(r.substream, false);
    // Default includeClientId=true
    assert.match(r.clientId, /^viewer-/);
  });

  await t.test("includeClientId: false omits clientId", async () => {
    const w = stub();
    w.cameraGetStreamInfo = async () => baseInfo;

    const r = await w.getCameraWebRTCConnectionInfo("AA", "MODEL", {
      includeClientId: false,
    });
    assert.strictEqual(r.clientId, undefined);
  });

  await t.test("does NOT modify signed signalingUrl by default", async () => {
    // Critical regression test: we previously injected X-Amz-ClientId into
    // the signed URL, which broke the AWS SigV4 signature and caused
    // WebSocket close 1006. The URL must come back unchanged from the
    // sanitization step.
    const w = stub();
    w.cameraGetStreamInfo = async () => ({
      signaling_url: "wss://kvs/?X-Amz-ClientId=ORIGINAL&X-Amz-Signature=sig",
      ice_servers: [],
      auth_token: null,
    });

    const r = await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    assert.strictEqual(
      r.signalingUrl,
      "wss://kvs/?X-Amz-ClientId=ORIGINAL&X-Amz-Signature=sig"
    );
  });
});

test("clearCameraStreamCache", async (t) => {
  await t.test("clears one mac, leaves others", async () => {
    const w = stub();
    let calls = 0;
    w.cameraGetStreamInfo = async () => {
      calls += 1;
      return { signaling_url: "wss://x", ice_servers: [], auth_token: null };
    };

    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    await w.getCameraWebRTCConnectionInfo("BB", "MODEL");
    assert.strictEqual(calls, 2);

    w.clearCameraStreamCache("AA");

    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    assert.strictEqual(calls, 3, "AA refetched after clear");
    await w.getCameraWebRTCConnectionInfo("BB", "MODEL");
    assert.strictEqual(calls, 3, "BB still cached");
  });

  await t.test("clears everything when called without args", async () => {
    const w = stub();
    let calls = 0;
    w.cameraGetStreamInfo = async () => {
      calls += 1;
      return { signaling_url: "wss://x", ice_servers: [], auth_token: null };
    };

    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    await w.getCameraWebRTCConnectionInfo("BB", "MODEL");
    w.clearCameraStreamCache();
    await w.getCameraWebRTCConnectionInfo("AA", "MODEL");
    await w.getCameraWebRTCConnectionInfo("BB", "MODEL");
    assert.strictEqual(calls, 4);
  });
});

test("cameraStreamWithReconnect retries with exponential backoff", async (t) => {
  await t.test("succeeds on first try", async () => {
    const w = stub();
    let calls = 0;
    const result = await w.cameraStreamWithReconnect(async () => {
      calls += 1;
      return "ok";
    });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 1);
  });

  await t.test("retries up to maxAttempts then throws", async () => {
    const w = stub();
    let calls = 0;
    const onRetry = [];
    await assert.rejects(
      w.cameraStreamWithReconnect(
        async () => {
          calls += 1;
          throw new Error("boom");
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1,
          onRetry: (n, e) => onRetry.push([n, e.message]),
        }
      ),
      /boom/
    );
    assert.strictEqual(calls, 3);
    assert.strictEqual(onRetry.length, 2); // called between attempts, not after final
  });

  await t.test("succeeds after a transient failure", async () => {
    const w = stub();
    let calls = 0;
    const result = await w.cameraStreamWithReconnect(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 1 }
    );
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);
  });
});

test("WyzeAPI.StreamStatus exports lifecycle constants and is frozen", () => {
  assert.deepStrictEqual(WyzeAPI.StreamStatus, {
    OFFLINE: -90,
    STOPPING: -1,
    DISABLED: 0,
    STOPPED: 1,
    CONNECTING: 2,
    CONNECTED: 3,
  });
  assert.ok(
    Object.isFrozen(WyzeAPI.StreamStatus),
    "StreamStatus must be frozen so consumers can't accidentally mutate it"
  );
});
