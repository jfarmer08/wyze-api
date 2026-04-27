/**
 * Bulb / light additions: lookup helpers + sun match + power loss recovery.
 * Network is stubbed via setProperty / getDevicePID.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "test";
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  w.maybeLogin = async () => {};
  return w;
};

const whiteBulb = { mac: "AA:BB:CC:WHITE", product_model: "WLPA19", nickname: "Lamp" };
const meshBulb = { mac: "AA:BB:CC:MESH", product_model: "WLPA19C", nickname: "Strip" };

test("module exports expose new light enums", () => {
  assert.strictEqual(WyzeAPI.LightControlMode.COLOR, 1);
  assert.strictEqual(WyzeAPI.LightControlMode.TEMPERATURE, 2);
  assert.strictEqual(WyzeAPI.LightControlMode.FRAGMENTED, 3);
  assert.strictEqual(WyzeAPI.LightPowerLossRecoveryMode.POWER_ON, 0);
  assert.strictEqual(WyzeAPI.LightPowerLossRecoveryMode.RESTORE_PREVIOUS_STATE, 1);
});

test("getBulbDeviceList filters by DeviceModels.BULB", async () => {
  const w = stub();
  w.getDeviceList = async () => [
    whiteBulb,
    meshBulb,
    { mac: "OTHER", product_model: "WYZEC1" }, // camera
    { mac: "PLUG", product_model: "WLPP1" },
    { mac: "STRIP", product_model: "HL_LSL" },
  ];
  const bulbs = await w.getBulbDeviceList();
  assert.deepStrictEqual(bulbs.map((d) => d.mac), [whiteBulb.mac, meshBulb.mac, "STRIP"]);
});

test("getBulb returns the matching device or undefined", async () => {
  const w = stub();
  w.getDeviceList = async () => [whiteBulb, meshBulb];
  const found = await w.getBulb(meshBulb.mac);
  assert.strictEqual(found.mac, meshBulb.mac);
  assert.strictEqual(await w.getBulb("NOPE"), undefined);
});

test("getBulbInfo merges list entry with property list (PID -> value)", async () => {
  const w = stub();
  w.getDeviceList = async () => [whiteBulb];
  w.getDevicePID = async () => ({
    data: {
      property_list: [
        { pid: "P3", value: "1" },
        { pid: "P1501", value: "75" },
        { pid: "P1502", value: "3500" },
      ],
    },
  });

  const info = await w.getBulbInfo(whiteBulb.mac);
  assert.strictEqual(info.mac, whiteBulb.mac);
  assert.strictEqual(info.nickname, "Lamp");
  assert.strictEqual(info.P3, "1");
  assert.strictEqual(info.P1501, "75");
  assert.strictEqual(info.P1502, "3500");
});

test("getBulbInfo returns null when mac is not a bulb", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "OTHER", product_model: "WYZEC1" }];
  assert.strictEqual(await w.getBulbInfo("MISSING"), null);
});

test("getBulbInfo tolerates property-list failure", async () => {
  const w = stub();
  w.getDeviceList = async () => [whiteBulb];
  w.getDevicePID = async () => {
    throw new Error("boom");
  };
  const info = await w.getBulbInfo(whiteBulb.mac);
  assert.strictEqual(info.mac, whiteBulb.mac);
  assert.strictEqual(info.P1501, undefined);
});

test("setBulbSunMatch writes P1528 with '1' or '0'", async () => {
  const w = stub();
  const calls = [];
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ mac, model, pid, value });
    return {};
  };

  await w.setBulbSunMatch(whiteBulb.mac, whiteBulb.product_model, true);
  await w.setBulbSunMatch(whiteBulb.mac, whiteBulb.product_model, false);

  assert.strictEqual(calls[0].pid, "P1528");
  assert.strictEqual(calls[0].value, "1");
  assert.strictEqual(calls[1].pid, "P1528");
  assert.strictEqual(calls[1].value, "0");
});

test("setBulbPowerLossRecovery writes P1509 with the mode value as string", async () => {
  const w = stub();
  let captured;
  w.setProperty = async (mac, model, pid, value) => {
    captured = { pid, value };
    return {};
  };

  await w.setBulbPowerLossRecovery(
    whiteBulb.mac,
    whiteBulb.product_model,
    WyzeAPI.LightPowerLossRecoveryMode.RESTORE_PREVIOUS_STATE
  );
  assert.strictEqual(captured.pid, "P1509");
  assert.strictEqual(captured.value, "1");

  await w.setBulbPowerLossRecovery(
    whiteBulb.mac,
    whiteBulb.product_model,
    WyzeAPI.LightPowerLossRecoveryMode.POWER_ON
  );
  assert.strictEqual(captured.value, "0");
});

test("device-object helpers forward to the right mac/model methods", async () => {
  const w = stub();
  const calls = [];
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ pid, value });
    return {};
  };

  await w.bulbSunMatchOn(whiteBulb);
  await w.bulbSunMatchOff(whiteBulb);
  await w.bulbSunMatch(whiteBulb, true);
  await w.bulbPowerLossRecovery(whiteBulb, WyzeAPI.LightPowerLossRecoveryMode.RESTORE_PREVIOUS_STATE);

  assert.deepStrictEqual(calls, [
    { pid: "P1528", value: "1" },
    { pid: "P1528", value: "0" },
    { pid: "P1528", value: "1" },
    { pid: "P1509", value: "1" },
  ]);
});

test("bulbInfo(device) forwards to getBulbInfo(mac)", async () => {
  const w = stub();
  let capturedMac;
  w.getBulbInfo = async (mac) => {
    capturedMac = mac;
    return { mac };
  };
  const result = await w.bulbInfo(whiteBulb);
  assert.strictEqual(capturedMac, whiteBulb.mac);
  assert.strictEqual(result.mac, whiteBulb.mac);
});

test("propertyIds includes the new light PIDs", () => {
  const types = require("../src/types");
  assert.strictEqual(types.propertyIds.CONTROL_LIGHT, "P1508");
  assert.strictEqual(types.propertyIds.POWER_LOSS_RECOVERY, "P1509");
  assert.strictEqual(types.propertyIds.SUN_MATCH, "P1528");
});
