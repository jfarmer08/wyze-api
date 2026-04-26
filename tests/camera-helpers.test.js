/**
 * Pure helpers on the WyzeAPI prototype — no network, no auth.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

const stub = () => Object.create(WyzeAPI.prototype);

test("cameraIsOnline", async (t) => {
  const w = stub();

  await t.test("conn_state takes priority", () => {
    assert.strictEqual(w.cameraIsOnline({ conn_state: 1 }), true);
    assert.strictEqual(w.cameraIsOnline({ conn_state: 0 }), false);
    // device_params.status is ignored when conn_state is present
    assert.strictEqual(
      w.cameraIsOnline({ conn_state: 1, device_params: { status: 0 } }),
      true
    );
  });

  await t.test("device_params.status fallback when no conn_state", () => {
    assert.strictEqual(w.cameraIsOnline({ device_params: { status: 1 } }), true);
    assert.strictEqual(w.cameraIsOnline({ device_params: { status: 0 } }), false);
  });

  await t.test("is_online final fallback", () => {
    assert.strictEqual(w.cameraIsOnline({ is_online: true }), true);
    assert.strictEqual(w.cameraIsOnline({ is_online: false }), false);
  });

  await t.test("returns false for empty / null / undefined", () => {
    assert.strictEqual(w.cameraIsOnline({}), false);
    assert.strictEqual(w.cameraIsOnline(null), false);
    assert.strictEqual(w.cameraIsOnline(undefined), false);
  });
});

test("cameraGetThumbnail", async (t) => {
  const w = stub();

  await t.test("returns first thumbnail URL", () => {
    assert.strictEqual(
      w.cameraGetThumbnail({
        device_params: { camera_thumbnails: [{ url: "https://a" }, { url: "https://b" }] },
      }),
      "https://a"
    );
  });

  await t.test("returns null when no thumbnails", () => {
    assert.strictEqual(w.cameraGetThumbnail({ device_params: {} }), null);
    assert.strictEqual(
      w.cameraGetThumbnail({ device_params: { camera_thumbnails: [] } }),
      null
    );
    assert.strictEqual(w.cameraGetThumbnail({}), null);
    assert.strictEqual(w.cameraGetThumbnail(null), null);
  });
});

test("cameraGetSnapshot returns full thumbnail object", () => {
  const w = stub();
  const thumb = { url: "https://x", ts: 1700000000, type: 1 };
  assert.deepStrictEqual(
    w.cameraGetSnapshot({ device_params: { camera_thumbnails: [thumb] } }),
    thumb
  );
  assert.strictEqual(w.cameraGetSnapshot({}), null);
});

test("cameraToSummary builds correct shape", () => {
  const w = stub();
  const device = {
    mac: "AA:BB:CC",
    product_model: "WYZE_CAKP",
    nickname: "Front",
    conn_state: 1,
    device_params: {
      camera_thumbnails: [{ url: "https://thumb" }],
    },
  };
  assert.deepStrictEqual(w.cameraToSummary(device), {
    mac: "AA:BB:CC",
    productModel: "WYZE_CAKP",
    nickname: "Front",
    online: true,
    thumbnail: "https://thumb",
  });
});

test("device-info accessors", async (t) => {
  const w = stub();
  const camera = {
    firmware_ver: "4.50.4.182",
    timezone_name: "America/New_York",
    device_params: {
      signal_strength: 67,
      ip: "192.168.1.5",
      last_login_time: 1700000000000,
    },
  };

  await t.test("cameraGetSignalStrength", () => {
    assert.strictEqual(w.cameraGetSignalStrength(camera), 67);
    assert.strictEqual(w.cameraGetSignalStrength({}), null);
    assert.strictEqual(w.cameraGetSignalStrength(null), null);
  });

  await t.test("cameraGetIp", () => {
    assert.strictEqual(w.cameraGetIp(camera), "192.168.1.5");
    assert.strictEqual(w.cameraGetIp({}), null);
  });

  await t.test("cameraGetFirmware reads top-level field", () => {
    assert.strictEqual(w.cameraGetFirmware(camera), "4.50.4.182");
    assert.strictEqual(w.cameraGetFirmware({}), null);
  });

  await t.test("cameraGetTimezone reads top-level field", () => {
    assert.strictEqual(w.cameraGetTimezone(camera), "America/New_York");
    assert.strictEqual(w.cameraGetTimezone({}), null);
  });

  await t.test("cameraGetLastSeen returns Date or null", () => {
    const d = w.cameraGetLastSeen(camera);
    assert.ok(d instanceof Date);
    assert.strictEqual(d.getTime(), 1700000000000);
    assert.strictEqual(w.cameraGetLastSeen({}), null);
    assert.strictEqual(
      w.cameraGetLastSeen({ device_params: { last_login_time: "not a number" } }),
      null
    );
  });
});
