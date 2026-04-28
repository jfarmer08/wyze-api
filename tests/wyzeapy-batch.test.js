/**
 * Cross-port batch from wyzeapy: DeviceMgmt camera API, motion-detection
 * bug fixes, event list, mesh-bulb sun-match, music mode, push info,
 * local-or-cloud bulb routing, enum supplements.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "test";
  w.userAgent = "test";
  w.appInfo = "test";
  w.phoneId = "test";
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warn: () => {}, warning: () => {}, debug: () => {} };
  w.maybeLogin = async () => {};
  return w;
};

// --- DeviceMgmt camera routing ----------------------------------------------

test("cameraTurnOn routes through DeviceMgmt for new-API models, runAction for legacy", async () => {
  const w = stub();
  const calls = [];
  w._deviceMgmtRunAction = async (mac, model, type, value) => {
    calls.push({ kind: "devicemgmt", model, type, value });
  };
  w.runAction = async (mac, model, action) => {
    calls.push({ kind: "runaction", model, action });
  };

  await w.cameraTurnOn("M", "LD_CFP"); // Floodlight Pro — DeviceMgmt
  await w.cameraTurnOn("M", "AN_RSCW"); // Battery Cam Pro — DeviceMgmt
  await w.cameraTurnOn("M", "GW_GC1"); // OG cam — DeviceMgmt
  await w.cameraTurnOn("M", "WYZE_CAKP2JFUS"); // V3 — legacy
  await w.cameraTurnOn("M", "WYZEC1"); // V1 — legacy

  assert.deepStrictEqual(calls.map((c) => c.kind), [
    "devicemgmt", "devicemgmt", "devicemgmt", "runaction", "runaction",
  ]);
  assert.deepStrictEqual(
    calls.filter((c) => c.kind === "devicemgmt").map((c) => c.value),
    ["wakeup", "wakeup", "wakeup"]
  );
  assert.deepStrictEqual(
    calls.filter((c) => c.kind === "runaction").map((c) => c.action),
    ["power_on", "power_on"]
  );
});

test("cameraTurnOff DeviceMgmt branch sends 'sleep'; legacy sends power_off", async () => {
  const w = stub();
  const calls = [];
  w._deviceMgmtRunAction = async (mac, model, type, value) => {
    calls.push({ kind: "dm", value });
  };
  w.runAction = async (mac, model, action) => {
    calls.push({ kind: "ra", action });
  };

  await w.cameraTurnOff("M", "LD_CFP");
  await w.cameraTurnOff("M", "WYZEC1");

  assert.deepStrictEqual(calls, [
    { kind: "dm", value: "sleep" },
    { kind: "ra", action: "power_off" },
  ]);
});

test("cameraSiren / cameraFloodLight route to DeviceMgmt for new-API models", async () => {
  const w = stub();
  const calls = [];
  w._deviceMgmtRunAction = async (mac, model, type, value) => {
    calls.push({ type, value });
  };

  await w.cameraSirenOn("M", "LD_CFP");
  await w.cameraSirenOff("M", "LD_CFP");
  await w.cameraFloodLightOn("M", "LD_CFP");
  await w.cameraFloodLightOff("M", "LD_CFP");

  assert.deepStrictEqual(calls, [
    { type: "siren", value: "siren-on" },
    { type: "siren", value: "siren-off" },
    { type: "floodlight", value: "1" },
    { type: "floodlight", value: "0" },
  ]);
});

test("cameraNotificationsOn/Off route to DeviceMgmt set_toggle for new-API models", async () => {
  const w = stub();
  const calls = [];
  w._deviceMgmtSetToggle = async (mac, model, toggleType, state) => {
    calls.push({ toggleType, state });
  };
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.cameraNotificationsOn("M", "LD_CFP");
  await w.cameraNotificationsOff("M", "WYZEC1");

  assert.strictEqual(calls[0].toggleType, WyzeAPI.DeviceMgmtToggleProps.NOTIFICATION_TOGGLE);
  assert.strictEqual(calls[0].state, "1");
  assert.strictEqual(calls[1].pid, "P1");
  assert.strictEqual(calls[1].value, "0");
});

// --- Motion detection — three paths ----------------------------------------

test("cameraMotionOn: DeviceMgmt path uses set_toggle EVENT_RECORDING", async () => {
  const w = stub();
  let captured;
  w._deviceMgmtSetToggle = async (mac, model, toggleType, state) => {
    captured = { toggleType, state };
  };
  await w.cameraMotionOn("M", "LD_CFP");
  assert.strictEqual(captured.toggleType, WyzeAPI.DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE);
  assert.strictEqual(captured.state, "1");
});

test("cameraMotionOn: WCO outdoor (WVOD1, HL_WCO2) writes only P1029", async () => {
  const w = stub();
  const calls = [];
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.cameraMotionOn("M", "WVOD1");
  await w.cameraMotionOn("M", "HL_WCO2");

  assert.deepStrictEqual(calls, [
    { pid: "P1029", value: "1" },
    { pid: "P1029", value: "1" },
  ]);
});

test("cameraMotionOn/Off: standard cameras now write BOTH P1047 and P1001 (was only P1001)", async () => {
  const w = stub();
  const calls = [];
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.cameraMotionOn("M", "WYZE_CAKP2JFUS");
  await w.cameraMotionOff("M", "WYZE_CAKP2JFUS");

  assert.deepStrictEqual(calls, [
    { pid: "P1047", value: 1 },
    { pid: "P1001", value: 1 },
    { pid: "P1047", value: 0 },
    { pid: "P1001", value: 0 },
  ]);
});

// --- DeviceMgmt capability builder -----------------------------------------

test("_deviceMgmtBuildCapability shapes match what new-API cameras expect", () => {
  const w = stub();

  assert.deepStrictEqual(w._deviceMgmtBuildCapability("floodlight", "1"), {
    iid: 4, name: "floodlight", properties: [{ prop: "on", value: "1" }],
  });
  assert.deepStrictEqual(w._deviceMgmtBuildCapability("spotlight", "0"), {
    iid: 5, name: "spotlight", properties: [{ prop: "on", value: "0" }],
  });
  assert.deepStrictEqual(w._deviceMgmtBuildCapability("power", "wakeup"), {
    functions: [{ in: { "wakeup-live-view": "1" }, name: "wakeup" }],
    iid: 1, name: "iot-device",
  });
  assert.deepStrictEqual(w._deviceMgmtBuildCapability("siren", "siren-on"), {
    functions: [{ in: {}, name: "siren-on" }], name: "siren",
  });
  assert.throws(() => w._deviceMgmtBuildCapability("unknown", "x"), /unsupported type/);
});

// --- Camera event list ------------------------------------------------------

test("getCameraEventList sends defaults + accepts overrides", async () => {
  const w = stub();
  const calls = [];
  w.request = async (path, data) => {
    calls.push({ path, data });
    return { data: {} };
  };

  await w.getCameraEventList();
  assert.strictEqual(calls[0].path, "app/v2/device/get_event_list");
  assert.strictEqual(calls[0].data.count, 20);
  assert.deepStrictEqual(calls[0].data.event_value_list, ["1", "13", "10", "12"]);
  assert.strictEqual(calls[0].data.order_by, 2);

  await w.getCameraEventList({
    count: 5,
    deviceMac: "AA:BB",
    beginTime: 1700000000000,
    endTime: 1700100000000,
    eventValueList: ["1"],
  });
  assert.strictEqual(calls[1].data.count, 5);
  assert.strictEqual(calls[1].data.device_mac, "AA:BB");
  assert.strictEqual(calls[1].data.begin_time, 1700000000000);
  assert.strictEqual(calls[1].data.end_time, 1700100000000);
  assert.deepStrictEqual(calls[1].data.event_value_list, ["1"]);
});

// --- setPushInfo ------------------------------------------------------------

test("setPushInfo writes app/user/set_push_info with '1'/'0'", async () => {
  const w = stub();
  const calls = [];
  w.request = async (path, data) => {
    calls.push({ path, data });
    return { data: {} };
  };

  await w.setPushInfo(true);
  await w.setPushInfo(false);

  assert.deepStrictEqual(calls.map((c) => c.data.push_switch), ["1", "0"]);
  assert.ok(calls.every((c) => c.path === "app/user/set_push_info"));
});

// --- Mesh-bulb sun-match fix -----------------------------------------------

test("setBulbSunMatch routes mesh color bulbs through setPropertyList (plural)", async () => {
  const w = stub();
  const calls = [];
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ kind: "single", pid, value });
  };
  w.setPropertyList = async (mac, model, plist) => {
    calls.push({ kind: "list", plist });
  };

  // Mesh color bulb — plural path
  await w.setBulbSunMatch("M", "WLPA19C", true);
  // Light strip — singular path (strips work fine with set_property)
  await w.setBulbSunMatch("M", "HL_LSL", true);
  // White bulb — singular path
  await w.setBulbSunMatch("M", "WLPA19", false);

  assert.strictEqual(calls[0].kind, "list");
  assert.deepStrictEqual(calls[0].plist, [{ pid: "P1528", pvalue: "1" }]);
  assert.strictEqual(calls[1].kind, "single");
  assert.strictEqual(calls[2].kind, "single");
});

test("setPropertyList wraps app/v2/device/set_property_list", async () => {
  const w = stub();
  let captured;
  w.request = async (path, data) => {
    captured = { path, data };
    return { data: {} };
  };

  await w.setPropertyList("M", "WLPA19C", [{ pid: "P1528", pvalue: "1" }]);
  assert.strictEqual(captured.path, "app/v2/device/set_property_list");
  assert.deepStrictEqual(captured.data.property_list, [{ pid: "P1528", pvalue: "1" }]);
});

// --- Bulb music mode --------------------------------------------------------

test("setBulbMusicMode requires a light strip; routes through runActionList for P1535", async () => {
  const w = stub();
  let captured;
  w.runActionList = async (mac, model, pid, value, action) => {
    captured = { pid, value, action };
  };

  await w.setBulbMusicMode("M", "HL_LSL", true);
  assert.strictEqual(captured.pid, "P1535");
  assert.strictEqual(captured.value, "1");
  assert.strictEqual(captured.action, "set_mesh_property");

  await assert.rejects(
    () => w.setBulbMusicMode("M", "WLPA19C", true),
    /not a light strip/
  );
});

test("bulbMusicModeOn / Off device-object helpers forward correctly", async () => {
  const w = stub();
  const calls = [];
  w.runActionList = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.bulbMusicModeOn({ mac: "M", product_model: "HL_LSLP" });
  await w.bulbMusicModeOff({ mac: "M", product_model: "HL_LSLP" });
  assert.deepStrictEqual(calls.map((c) => c.value), ["1", "0"]);
});

// --- Local-or-cloud bulb routing -------------------------------------------

test("bulbLocalOrCloud tries local first when device has enr+ip", async () => {
  const w = stub();
  const calls = [];
  w.localBulbCommand = async () => {
    calls.push("local");
    return {};
  };
  w.runActionList = async () => {
    calls.push("cloud");
    return {};
  };

  await w.bulbLocalOrCloud(
    { mac: "M", product_model: "WLPA19C", enr: "abc", device_params: { ip: "10.0.0.5" } },
    "P3", "1", "set_mesh_property"
  );
  assert.deepStrictEqual(calls, ["local"]);
});

test("bulbLocalOrCloud falls back to cloud when local fails", async () => {
  const w = stub();
  const calls = [];
  w.localBulbCommand = async () => {
    calls.push("local-tried");
    throw new Error("LAN unreachable");
  };
  w.runActionList = async () => {
    calls.push("cloud");
    return {};
  };

  await w.bulbLocalOrCloud(
    { mac: "M", product_model: "WLPA19C", enr: "abc", device_params: { ip: "10.0.0.5" } },
    "P3", "1", "set_mesh_property"
  );
  assert.deepStrictEqual(calls, ["local-tried", "cloud"]);
});

test("bulbLocalOrCloud goes straight to cloud when device lacks enr/ip", async () => {
  const w = stub();
  const calls = [];
  w.localBulbCommand = async () => {
    calls.push("local");
  };
  w.runActionList = async () => {
    calls.push("cloud");
  };

  await w.bulbLocalOrCloud(
    { mac: "M", product_model: "WLPA19C" }, // no enr, no ip
    "P3", "1", "set_mesh_property"
  );
  assert.deepStrictEqual(calls, ["cloud"]);
});

// --- Enum supplements -------------------------------------------------------

test("HMSStatus / HVACState / DeviceMgmtToggleProps / Irrigation* exposed on WyzeAPI", () => {
  assert.strictEqual(WyzeAPI.HMSStatus.AWAY, "away");
  assert.strictEqual(WyzeAPI.HMSStatus.DISARMED, "off");

  assert.strictEqual(WyzeAPI.HVACState.CHANGING, "changing");

  assert.strictEqual(
    WyzeAPI.DeviceMgmtToggleProps.NOTIFICATION_TOGGLE.pageId,
    "cam_device_notify"
  );
  assert.strictEqual(
    WyzeAPI.DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE.toggleId,
    "ge.motion_detect_recording"
  );

  assert.strictEqual(WyzeAPI.IrrigationCropType.SHRUBS, "shrubs");
  assert.strictEqual(WyzeAPI.IrrigationSlopeType.STEEP, "steep");
  assert.strictEqual(WyzeAPI.IrrigationSoilType.SANDY_LOAM, "sandy_loam");
  assert.strictEqual(WyzeAPI.IrrigationNozzleType.MISTER, "mister");
  assert.strictEqual(WyzeAPI.IrrigationExposureType.LOTS_OF_SUN, "lots_of_sun");
});

// --- Light Strip Pro per-subsection colors --------------------------------

test("setBulbColor on Light Strip Pro with single HEX replicates to all 16 subsections", async () => {
  const w = stub();
  let captured;
  w.runActionListMulti = async (mac, model, plist, actionKey) => {
    captured = { plist, actionKey };
  };

  await w.setBulbColor("M", "HL_LSLP", "ff0000");
  assert.strictEqual(captured.actionKey, "set_mesh_property");
  assert.strictEqual(captured.plist[0].pid, "P1515");
  assert.strictEqual(captured.plist[1].pid, "P1508");

  // Subsection format: "00" + "FF0000#00FF0000#00..." (16 colors joined by "#00")
  const expected = "00" + Array(16).fill("FF0000").join("#00");
  assert.strictEqual(captured.plist[0].pvalue, expected);
  assert.strictEqual(captured.plist[1].pvalue, "1"); // LightControlMode.COLOR
});

test("setBulbColor on Light Strip Pro with array of 16 HEX uses per-subsection colors", async () => {
  const w = stub();
  let captured;
  w.runActionListMulti = async (mac, model, plist) => {
    captured = plist;
  };

  const colors = Array.from({ length: 16 }, (_, i) =>
    i.toString(16).padStart(2, "0").toUpperCase().repeat(3)
  );
  await w.setBulbColor("M", "HL_LSLP", colors);
  const expected = "00" + colors.join("#00");
  assert.strictEqual(captured[0].pid, "P1515");
  assert.strictEqual(captured[0].pvalue, expected);
});

test("setBulbColor rejects array input on non-Pro models and wrong-length arrays on Pro", async () => {
  const w = stub();
  w.runActionListMulti = async () => {};
  w.runActionList = async () => {};

  await assert.rejects(
    () => w.setBulbColor("M", "WLPA19C", ["FF0000", "00FF00"]),
    /only supported on Light Strip Pro/
  );
  await assert.rejects(
    () => w.setBulbColor("M", "HL_LSL", Array(16).fill("FF0000")),
    /only supported on Light Strip Pro/
  );
  await assert.rejects(
    () => w.setBulbColor("M", "HL_LSLP", ["FF0000"]),
    /exactly 16 colors/
  );
  await assert.rejects(
    () => w.setBulbColor("M", "HL_LSLP", [...Array(15).fill("FF0000"), "bad"]),
    /not a 6-char HEX/
  );
});

test("setBulbColor on non-Pro light strip still uses sequential P1507 + P1508 (unchanged)", async () => {
  const w = stub();
  const calls = [];
  w.runActionList = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.setBulbColor("M", "HL_LSL", "00ff00");
  assert.deepStrictEqual(calls, [
    { pid: "P1507", value: "00FF00" },
    { pid: "P1508", value: 1 },
  ]);
});

test("setBulbColor on plain mesh color bulb (WLPA19C) writes only P1507", async () => {
  const w = stub();
  const calls = [];
  w.runActionList = async (mac, model, pid, value) => {
    calls.push({ pid, value });
  };

  await w.setBulbColor("M", "WLPA19C", "ABCDEF");
  assert.deepStrictEqual(calls, [{ pid: "P1507", value: "ABCDEF" }]);
});

test("DeviceModels includes the new camera categories", () => {
  const types = require("../src/types");
  assert.deepStrictEqual(types.DeviceModels.CAMERA_DEVICEMGMT, ["LD_CFP", "AN_RSCW", "GW_GC1"]);
  assert.deepStrictEqual(types.DeviceModels.CAMERA_OUTDOOR_V2, ["HL_WCO2"]);
  assert.ok(types.DeviceModels.CAMERA.includes("LD_CFP"));
  assert.ok(types.DeviceModels.CAMERA.includes("HL_WCO2"));
});
