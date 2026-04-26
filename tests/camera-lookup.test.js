/**
 * Lookup helpers — getCameras / getCamera / snapshots / summaries.
 * Stubs `getDeviceList` on a prototype-based instance so no network calls.
 */
const test = require("node:test");
const assert = require("node:assert");
const WyzeAPI = require("../src/index");

function stubWith(devices) {
  const w = Object.create(WyzeAPI.prototype);
  w.getDeviceList = async () => devices;
  return w;
}

const DEVICES = [
  {
    mac: "CAM1",
    product_type: "Camera",
    product_model: "WYZE_CAKP",
    nickname: "Front Porch",
    conn_state: 1,
    device_params: {
      camera_thumbnails: [{ url: "https://thumb/cam1.jpg", ts: 100 }],
      ip: "192.168.1.10",
    },
  },
  {
    mac: "CAM2",
    product_type: "camera", // case-insensitive match
    product_model: "WYZEDB3",
    nickname: "Doorbell",
    conn_state: 0,
    device_params: {},
  },
  {
    mac: "BULB1",
    product_type: "Light",
    product_model: "WLPA19",
    nickname: "Lamp",
  },
  {
    mac: "PLUG1",
    product_type: "Plug",
    product_model: "WLPP1",
    nickname: "Outlet",
  },
];

test("getCameras filters by product_type === 'Camera' (case-insensitive)", async () => {
  const w = stubWith(DEVICES);
  const cameras = await w.getCameras();
  assert.deepStrictEqual(
    cameras.map((c) => c.mac),
    ["CAM1", "CAM2"]
  );
});

test("getOnlineCameras / getOfflineCameras", async () => {
  const w = stubWith(DEVICES);
  const online = await w.getOnlineCameras();
  const offline = await w.getOfflineCameras();
  assert.deepStrictEqual(online.map((c) => c.mac), ["CAM1"]);
  assert.deepStrictEqual(offline.map((c) => c.mac), ["CAM2"]);
});

test("getCamera returns by MAC, undefined when missing", async () => {
  const w = stubWith(DEVICES);
  const cam = await w.getCamera("CAM1");
  assert.strictEqual(cam.nickname, "Front Porch");
  assert.strictEqual(await w.getCamera("DOES_NOT_EXIST"), undefined);
  // Non-cameras are not in the result set even if mac matches
  assert.strictEqual(await w.getCamera("BULB1"), undefined);
});

test("getCameraByName matches case-insensitively", async () => {
  const w = stubWith(DEVICES);
  assert.strictEqual((await w.getCameraByName("Front Porch")).mac, "CAM1");
  assert.strictEqual((await w.getCameraByName("FRONT PORCH")).mac, "CAM1");
  assert.strictEqual((await w.getCameraByName("front porch")).mac, "CAM1");
  assert.strictEqual(await w.getCameraByName("nope"), undefined);
});

test("getCameraSnapshot returns first thumbnail object", async () => {
  const w = stubWith(DEVICES);
  const snap = await w.getCameraSnapshot("CAM1");
  assert.deepStrictEqual(snap, { url: "https://thumb/cam1.jpg", ts: 100 });
});

test("getCameraSnapshot returns null when no thumbnails", async () => {
  const w = stubWith(DEVICES);
  assert.strictEqual(await w.getCameraSnapshot("CAM2"), null);
});

test("getCameraSnapshot returns null when camera not found", async () => {
  const w = stubWith(DEVICES);
  assert.strictEqual(await w.getCameraSnapshot("MISSING"), null);
});

test("getCameraSnapshotUrl pulls just the URL", async () => {
  const w = stubWith(DEVICES);
  assert.strictEqual(
    await w.getCameraSnapshotUrl("CAM1"),
    "https://thumb/cam1.jpg"
  );
  assert.strictEqual(await w.getCameraSnapshotUrl("CAM2"), null);
});

test("getCameraSummaries returns one summary per camera", async () => {
  const w = stubWith(DEVICES);
  const summaries = await w.getCameraSummaries();
  assert.strictEqual(summaries.length, 2);
  assert.deepStrictEqual(summaries[0], {
    mac: "CAM1",
    productModel: "WYZE_CAKP",
    nickname: "Front Porch",
    online: true,
    thumbnail: "https://thumb/cam1.jpg",
  });
  assert.deepStrictEqual(summaries[1], {
    mac: "CAM2",
    productModel: "WYZEDB3",
    nickname: "Doorbell",
    online: false,
    thumbnail: null,
  });
});
