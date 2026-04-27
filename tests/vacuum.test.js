/**
 * Robot Vacuum (Venus service) — pure helpers and signing.
 * Network-touching paths are exercised by stubbing `_venusRequest`.
 */
const test = require("node:test");
const assert = require("node:assert");
const nodeCrypto = require("crypto");

const WyzeAPI = require("../src/index");
const venusCrypto = require("../src/utils/crypto");
const constants = require("../src/constants");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "test-access-token";
  w.userAgent = "unofficial-wyze-api/test";
  w.appInfo = constants.appInfo;
  w.phoneId = constants.phoneId;
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  w.maybeLogin = async () => {};
  return w;
};

test("venusGenerateDynamicSignature matches HMAC-MD5 with md5(token+secret) key", () => {
  const token = "abc123";
  const body = '{"did":"JA_RO2_XXX","nonce":"1700000000000"}';

  const expectedKey = nodeCrypto
    .createHash("md5")
    .update(token + constants.venusSigningSecret)
    .digest("hex");
  const expected = nodeCrypto.createHmac("md5", expectedKey).update(body).digest("hex");

  assert.strictEqual(venusCrypto.venusGenerateDynamicSignature(body, token), expected);
});

test("venusRequestId is md5(md5(String(nonce)))", () => {
  const nonce = 1700000000000;
  const inner = nodeCrypto.createHash("md5").update(String(nonce)).digest("hex");
  const expected = nodeCrypto.createHash("md5").update(inner).digest("hex");
  assert.strictEqual(venusCrypto.venusRequestId(nonce), expected);
});

test("_venusSortedQuery sorts keys lexicographically and joins as k=v&k=v", () => {
  const w = stub();
  assert.strictEqual(
    w._venusSortedQuery({ did: "X", count: 5, nonce: 1700000000000 }),
    "count=5&did=X&nonce=1700000000000"
  );
});

test("_venusBuildHeaders includes the full Venus header set", () => {
  const w = stub();
  const headers = w._venusBuildHeaders(1700000000000, "deadbeef");

  assert.strictEqual(headers.access_token, "test-access-token");
  assert.strictEqual(headers.appid, constants.venusAppId);
  assert.strictEqual(headers.appinfo, constants.appInfo);
  assert.strictEqual(headers.phoneid, constants.phoneId);
  assert.strictEqual(headers.signature2, "deadbeef");
  assert.strictEqual(headers["Accept-Encoding"], "gzip");
  // requestid is deterministic from nonce
  assert.strictEqual(headers.requestid, venusCrypto.venusRequestId(1700000000000));
});

test("vacuumControl posts to /plugin/venus/{mac}/control with type/value/vacuumMopMode", async () => {
  const w = stub();
  let captured;
  w._venusRequest = async (method, path, payload) => {
    captured = { method, path, payload };
    return { code: "1" };
  };

  await w.vacuumControl("JA_RO2_ABC", 0, 1);
  assert.strictEqual(captured.method, "POST");
  assert.strictEqual(captured.path, "/plugin/venus/JA_RO2_ABC/control");
  assert.deepStrictEqual(captured.payload, { type: 0, value: 1, vacuumMopMode: 0 });
});

test("vacuumClean / vacuumPause / vacuumDock / vacuumStop send correct codes", async () => {
  const w = stub();
  const calls = [];
  w._venusRequest = async (method, path, payload) => {
    calls.push({ path, payload });
    return { code: "1" };
  };

  await w.vacuumClean("M");
  await w.vacuumPause("M");
  await w.vacuumDock("M");
  await w.vacuumStop("M");

  assert.deepStrictEqual(calls.map((c) => c.payload), [
    { type: 0, value: 1, vacuumMopMode: 0 }, // GLOBAL_SWEEPING + START
    { type: 0, value: 2, vacuumMopMode: 0 }, // GLOBAL_SWEEPING + PAUSE
    { type: 3, value: 1, vacuumMopMode: 0 }, // RETURN_TO_CHARGING + START
    { type: 3, value: 0, vacuumMopMode: 0 }, // RETURN_TO_CHARGING + STOP
  ]);
});

test("vacuumSweepRooms wraps a single room id in an array and includes rooms_id", async () => {
  const w = stub();
  let captured;
  w._venusRequest = async (method, path, payload) => {
    captured = payload;
    return {};
  };

  await w.vacuumSweepRooms("M", 11);
  assert.deepStrictEqual(captured.rooms_id, [11]);

  await w.vacuumSweepRooms("M", [11, 14]);
  assert.deepStrictEqual(captured.rooms_id, [11, 14]);
});

test("vacuumSetSuctionLevel posts to set_iot_action with set_preference command", async () => {
  const w = stub();
  let captured;
  w._venusRequest = async (method, path, payload) => {
    captured = { method, path, payload };
    return {};
  };

  await w.vacuumSetSuctionLevel("M", "JA_RO2", WyzeAPI.VacuumSuctionLevel.QUIET);
  assert.strictEqual(captured.method, "POST");
  assert.strictEqual(captured.path, "/plugin/venus/set_iot_action");
  assert.strictEqual(captured.payload.cmd, "set_preference");
  assert.strictEqual(captured.payload.did, "M");
  assert.strictEqual(captured.payload.model, "JA_RO2");
  assert.deepStrictEqual(captured.payload.params, [{ ctrltype: 1, value: 1 }]);
});

test("getVacuumIotProp / getVacuumDeviceInfo accept array keys and join them", async () => {
  const w = stub();
  const calls = [];
  w._venusRequest = async (method, path, payload) => {
    calls.push({ method, path, payload });
    return {};
  };

  await w.getVacuumIotProp("M", ["mode", "battary"]);
  await w.getVacuumDeviceInfo("M", "cleanlevel");

  assert.deepStrictEqual(calls[0].payload, { did: "M", keys: "mode,battary" });
  assert.deepStrictEqual(calls[1].payload, { device_id: "M", keys: "cleanlevel" });
});

test("getVacuumSweepRecords accepts Date or epoch ms for `since`", async () => {
  const w = stub();
  const calls = [];
  w._venusRequest = async (method, path, payload) => {
    calls.push(payload);
    return {};
  };

  const epoch = 1700000000000;
  await w.getVacuumSweepRecords("M", { limit: 5, since: epoch });
  await w.getVacuumSweepRecords("M", { limit: 5, since: new Date(epoch) });

  assert.strictEqual(calls[0].last_time, epoch);
  assert.strictEqual(calls[1].last_time, epoch);
  assert.strictEqual(calls[0].count, 5);
  assert.strictEqual(calls[0].purpose, "history_map");
});

test("getVacuumDeviceList filters by product_model JA_RO2", async () => {
  const w = stub();
  w.getDeviceList = async () => [
    { mac: "A", product_model: "WYZEC1" },
    { mac: "B", product_model: "JA_RO2" },
    { mac: "C", product_model: "JA_RO2" },
  ];

  const vacuums = await w.getVacuumDeviceList();
  assert.deepStrictEqual(vacuums.map((d) => d.mac), ["B", "C"]);
});

test("module exports expose vacuum enums", () => {
  assert.strictEqual(WyzeAPI.VacuumControlType.GLOBAL_SWEEPING, 0);
  assert.strictEqual(WyzeAPI.VacuumControlType.RETURN_TO_CHARGING, 3);
  assert.strictEqual(WyzeAPI.VacuumControlValue.START, 1);
  assert.strictEqual(WyzeAPI.VacuumControlValue.PAUSE, 2);
  assert.strictEqual(WyzeAPI.VacuumStatus.DOCKED, 4);
  assert.strictEqual(WyzeAPI.VacuumSuctionLevel.STRONG, 3);
  assert.ok(Array.isArray(WyzeAPI.VacuumIotPropKeys));
  assert.ok(WyzeAPI.VacuumIotPropKeys.includes("battary")); // typo preserved
  assert.deepStrictEqual([...WyzeAPI.VacuumDeviceInfoKeys].sort(), [
    "device_type",
    "ipaddr",
    "mac",
    "mcu_sys_version",
  ]);
});

test("vacuumCancel sends RETURN_TO_CHARGING + STOP (same wire as vacuumStop)", async () => {
  const w = stub();
  let captured;
  w._venusRequest = async (_method, _path, payload) => {
    captured = payload;
    return {};
  };

  await w.vacuumCancel("M");
  assert.deepStrictEqual(captured, { type: 3, value: 0, vacuumMopMode: 0 });
});

test("device-object helpers forward to mac/model methods", async () => {
  const w = stub();
  const calls = [];
  w._venusRequest = async (method, path, payload) => {
    calls.push({ path, payload });
    return {};
  };

  const device = { mac: "JA_RO2_ABC", product_model: "JA_RO2", nickname: "Roomy" };

  await w.vacuumStartCleaning(device);
  await w.vacuumPauseCleaning(device);
  await w.vacuumReturnToDock(device);
  await w.vacuumQuiet(device);
  await w.vacuumStandard(device);
  await w.vacuumStrong(device);
  await w.vacuumCleanRooms(device, [11, 14]);

  assert.strictEqual(calls[0].path, "/plugin/venus/JA_RO2_ABC/control");
  assert.deepStrictEqual(calls[0].payload, { type: 0, value: 1, vacuumMopMode: 0 });
  assert.deepStrictEqual(calls[1].payload, { type: 0, value: 2, vacuumMopMode: 0 });
  assert.deepStrictEqual(calls[2].payload, { type: 3, value: 1, vacuumMopMode: 0 });
  assert.strictEqual(calls[3].path, "/plugin/venus/set_iot_action");
  assert.deepStrictEqual(calls[3].payload.params, [{ ctrltype: 1, value: 1 }]);
  assert.deepStrictEqual(calls[4].payload.params, [{ ctrltype: 1, value: 2 }]);
  assert.deepStrictEqual(calls[5].payload.params, [{ ctrltype: 1, value: 3 }]);
  assert.deepStrictEqual(calls[6].payload.rooms_id, [11, 14]);
});

test("pure info accessors read battery, mode, fault, charging, cleaning, docked", () => {
  const w = stub();

  assert.strictEqual(w.vacuumGetBattery({ battary: 87 }), 87);
  assert.strictEqual(w.vacuumGetBattery({}), null);
  assert.strictEqual(w.vacuumGetBattery(null), null);

  assert.strictEqual(w.vacuumGetMode({ mode: 1 }), "CLEANING");
  assert.strictEqual(w.vacuumGetMode({ mode: 99999 }), null);
  assert.strictEqual(w.vacuumGetMode(null), null);

  assert.strictEqual(w.vacuumGetFault({ fault_code: 0 }), null);
  assert.deepStrictEqual(w.vacuumGetFault({ fault_code: 514 }), {
    code: 514,
    description: "Wheels stuck",
  });
  assert.deepStrictEqual(w.vacuumGetFault({ fault_code: 9999 }), {
    code: 9999,
    description: null,
  });

  assert.strictEqual(w.vacuumIsCharging({ chargeState: 1 }), true);
  assert.strictEqual(w.vacuumIsCharging({ chargeState: 0 }), false);
  assert.strictEqual(w.vacuumIsCharging({}), false);

  assert.strictEqual(w.vacuumIsCleaning({ mode: 1 }), true);
  assert.strictEqual(w.vacuumIsCleaning({ mode: 4 }), false);

  assert.strictEqual(w.vacuumIsDocked({ chargeState: 1, mode: 0 }), true);
  assert.strictEqual(w.vacuumIsDocked({ chargeState: 0, mode: 1 }), false);
});

test("vacuumEventTracking posts emulation envelope with positional args", async () => {
  const w = stub();
  w.appVersion = "wyze_developer_api";
  let captured;
  w._venusRequest = async (method, path, payload) => {
    captured = { method, path, payload };
    return {};
  };

  await w.vacuumEventTracking(
    "M",
    WyzeAPI.VacuumControlType.GLOBAL_SWEEPING,
    WyzeAPI.VacuumControlValue.START,
    [WyzeAPI.VenusDotArg1.Vacuum, WyzeAPI.VenusDotArg2.Whole, WyzeAPI.VenusDotArg3.Start]
  );

  assert.strictEqual(captured.method, "POST");
  assert.strictEqual(captured.path, "/plugin/venus/event_tracking");
  assert.strictEqual(captured.payload.deviceId, "M");
  assert.strictEqual(captured.payload.eventKey, "Clean");
  assert.strictEqual(captured.payload.eventType, 1);
  assert.strictEqual(captured.payload.arg1, "Vacuum");
  assert.strictEqual(captured.payload.arg2, "Whole");
  assert.strictEqual(captured.payload.arg3, "Start");
  assert.strictEqual(captured.payload.arg11, "ios");
  assert.strictEqual(captured.payload.arg12, "iPhone 13 mini");
  assert.match(captured.payload.mcuSysVersion, /^\d+\.\d+\.\d+$/);
  assert.match(captured.payload.pluginVersion, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(captured.payload.uuid.length, 32);
});

test("parseVacuumMode maps codes to mode names and returns null for unknown", () => {
  assert.strictEqual(WyzeAPI.parseVacuumMode(1), "CLEANING");
  assert.strictEqual(WyzeAPI.parseVacuumMode(1101), "CLEANING");
  assert.strictEqual(WyzeAPI.parseVacuumMode(4), "PAUSED");
  assert.strictEqual(WyzeAPI.parseVacuumMode(11), "DOCKED_NOT_COMPLETE");
  assert.strictEqual(WyzeAPI.parseVacuumMode(0), "IDLE");
  assert.strictEqual(WyzeAPI.parseVacuumMode(99999), null);
  assert.strictEqual(WyzeAPI.parseVacuumMode(null), null);
  assert.strictEqual(WyzeAPI.parseVacuumMode(undefined), null);
});

test("VacuumFaultCode looks up known fault descriptions", () => {
  assert.strictEqual(WyzeAPI.VacuumFaultCode[500], "Lidar sensor blocked");
  assert.strictEqual(WyzeAPI.VacuumFaultCode[514], "Wheels stuck");
  assert.strictEqual(WyzeAPI.VacuumFaultCode[567], "Vacuum stuck in no-go zone");
});

test("getVacuumInfo merges list entry, iot_prop, device_info, status, position, and map", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "M", product_model: "JA_RO2", nickname: "Roomy" }];

  w.getVacuumIotProp = async (mac, keys) => {
    assert.strictEqual(mac, "M");
    assert.ok(keys.includes("battary"));
    return { data: { props: { battary: 87, mode: 1, cleanlevel: "2" } } };
  };
  w.getVacuumDeviceInfo = async (mac, keys) => {
    assert.strictEqual(mac, "M");
    assert.ok(keys.includes("ipaddr"));
    return { data: { settings: { ipaddr: "10.0.0.5", mcu_sys_version: "1.6.113" } } };
  };
  w.getVacuumStatus = async () => ({
    data: { eventFlag: { fault_code: 0 }, heartBeat: { rssi: -42 } },
  });
  w.getVacuumCurrentPosition = async () => ({ data: { x: 1, y: 2 } });
  w.getVacuumCurrentMap = async () => ({ data: { map_id: 12345678 } });

  const info = await w.getVacuumInfo("M");
  assert.strictEqual(info.mac, "M");
  assert.strictEqual(info.nickname, "Roomy");
  assert.strictEqual(info.battary, 87);
  assert.strictEqual(info.mode, 1);
  assert.strictEqual(info.ipaddr, "10.0.0.5");
  assert.strictEqual(info.fault_code, 0);
  assert.strictEqual(info.rssi, -42);
  assert.deepStrictEqual(info.current_position, { x: 1, y: 2 });
  assert.deepStrictEqual(info.current_map, { map_id: 12345678 });
});

test("getVacuumInfo returns null when mac is not a vacuum on the account", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "OTHER", product_model: "WYZEC1" }];
  assert.strictEqual(await w.getVacuumInfo("M"), null);
});

test("getVacuumInfo tolerates failures in individual sub-fetches", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "M", product_model: "JA_RO2" }];
  w.getVacuumIotProp = async () => {
    throw new Error("boom");
  };
  w.getVacuumDeviceInfo = async () => ({ data: { settings: { ipaddr: "10.0.0.5" } } });
  w.getVacuumStatus = async () => {
    throw new Error("boom");
  };
  w.getVacuumCurrentPosition = async () => ({ data: { x: 0, y: 0 } });
  w.getVacuumCurrentMap = async () => null;

  const info = await w.getVacuumInfo("M");
  assert.strictEqual(info.mac, "M");
  assert.strictEqual(info.ipaddr, "10.0.0.5");
  assert.deepStrictEqual(info.current_position, { x: 0, y: 0 });
  assert.strictEqual(info.battary, undefined); // iot_prop failed
});
