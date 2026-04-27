/**
 * Tests for the wyze-sdk parity batch: timers, sensors, mixin accessors,
 * thermostat info methods, lock access codes, bulb color setters.
 *
 * Network is stubbed; pure helpers are tested directly.
 */
const test = require("node:test");
const assert = require("node:assert");
const nodeCrypto = require("crypto");

const WyzeAPI = require("../src/index");
const wyzeCrypto = require("../src/utils/crypto");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "test";
  w.userAgent = "test";
  w.appInfo = "test";
  w.phoneId = "test";
  w.lowBatteryPercentage = 30;
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  w.maybeLogin = async () => {};
  return w;
};

// --- Timer primitives -------------------------------------------------------

test("setDeviceTimer / cancelDeviceTimer / getDeviceTimer hit /app/v2/device/timer/* paths", async () => {
  const w = stub();
  const calls = [];
  w.request = async (path, data) => {
    calls.push({ path, data });
    return { data: { ok: true } };
  };

  await w.setDeviceTimer("MAC", 60, 1);
  await w.getDeviceTimer("MAC");
  await w.cancelDeviceTimer("MAC");

  assert.strictEqual(calls[0].path, "app/v2/device/timer/set");
  assert.strictEqual(calls[0].data.device_mac, "MAC");
  assert.strictEqual(calls[0].data.action_type, 1);
  assert.strictEqual(calls[0].data.action_value, 1);
  assert.strictEqual(calls[0].data.delay_time, 60);
  assert.strictEqual(typeof calls[0].data.plan_execute_ts, "number");

  assert.strictEqual(calls[1].path, "app/v2/device/timer/get");
  assert.strictEqual(calls[2].path, "app/v2/device/timer/cancel");
});

test("plug/light/switch/bulb timer wrappers route through setDeviceTimer with right action_value", async () => {
  const w = stub();
  const calls = [];
  w.request = async (path, data) => {
    calls.push({ path, data });
    return { data: {} };
  };

  await w.plugTurnOnAfter("M", 60);
  await w.plugTurnOffAfter("M", 60);
  await w.lightTurnOnAfter("M", 60);
  await w.lightTurnOffAfter("M", 60);
  await w.bulbTurnOnAfter("M", 60);
  await w.bulbTurnOffAfter("M", 60);
  await w.wallSwitchPowerOnAfter("M", 60);
  await w.wallSwitchPowerOffAfter("M", 60);

  assert.deepStrictEqual(calls.map((c) => c.data.action_value), [1, 0, 1, 0, 1, 0, 1, 0]);
  assert.ok(calls.every((c) => c.path === "app/v2/device/timer/set"));
});

test("clear*Timer all hit /app/v2/device/timer/cancel", async () => {
  const w = stub();
  const paths = [];
  w.request = async (path) => {
    paths.push(path);
    return { data: {} };
  };

  await w.clearPlugTimer("M");
  await w.clearLightTimer("M");
  await w.clearBulbTimer("M");
  await w.clearWallSwitchTimer("M");

  assert.deepStrictEqual(paths, [
    "app/v2/device/timer/cancel",
    "app/v2/device/timer/cancel",
    "app/v2/device/timer/cancel",
    "app/v2/device/timer/cancel",
  ]);
});

// --- Camera restart ---------------------------------------------------------

test("cameraRestart calls runAction with 'restart' action key", async () => {
  const w = stub();
  let captured;
  w.runAction = async (mac, model, action) => {
    captured = { mac, model, action };
    return {};
  };

  await w.cameraRestart("MAC", "WYZEC1");
  assert.deepStrictEqual(captured, { mac: "MAC", model: "WYZEC1", action: "restart" });
});

// --- Plug usage records -----------------------------------------------------

test("getPlugUsageRecords sends device_mac + epoch ms (Date or number)", async () => {
  const w = stub();
  let captured;
  w.request = async (path, data) => {
    captured = { path, data };
    return { data: [] };
  };

  await w.getPlugUsageRecords("MAC", { startTime: new Date(1700000000000), endTime: 1700100000000 });
  assert.strictEqual(captured.path, "app/v2/plug/usage_record_list");
  assert.strictEqual(captured.data.device_mac, "MAC");
  assert.strictEqual(captured.data.date_begin, 1700000000000);
  assert.strictEqual(captured.data.date_end, 1700100000000);

  await assert.rejects(() => w.getPlugUsageRecords("MAC", {}), /startTime.*required/);
});

// --- Wall-switch press types -----------------------------------------------

test("wall-switch press-type setters write the right IoT prop keys", async () => {
  const w = stub();
  const calls = [];
  w.setIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.setWallSwitchSinglePressType("M", "LD_SS1", 5);
  await w.setWallSwitchDoublePressType("M", "LD_SS1", 6);
  await w.setWallSwitchTriplePressType("M", "LD_SS1", 7);
  await w.setWallSwitchLongPressType("M", "LD_SS1", 8);
  await w.setWallSwitchPressTypesEnabled("M", "LD_SS1", true);

  assert.deepStrictEqual(calls, [
    { key: "single_press_type", value: 5 },
    { key: "double_press_type", value: 6 },
    { key: "triple_press_type", value: 7 },
    { key: "long_press_type", value: 8 },
    { key: "additional_interaction_switch", value: true },
  ]);
});

// --- Bulb color setters -----------------------------------------------------

test("setBulbColor writes HEX to P1507; rejects bad input; rejects non-mesh model", async () => {
  const w = stub();
  const calls = [];
  w.runActionList = async (mac, model, pid, value, action) => {
    calls.push({ pid, value, action });
    return {};
  };

  await w.setBulbColor("M", "WLPA19C", "ff5733");
  // mesh bulb: only color write, no control-mode flip (not a strip)
  assert.deepStrictEqual(calls, [
    { pid: "P1507", value: "FF5733", action: "set_mesh_property" },
  ]);

  // light strip: also flips control_light to COLOR
  calls.length = 0;
  await w.setBulbColor("M", "HL_LSL", "00ff00");
  assert.deepStrictEqual(calls, [
    { pid: "P1507", value: "00FF00", action: "set_mesh_property" },
    { pid: "P1508", value: WyzeAPI.LightControlMode.COLOR, action: "set_mesh_property" },
  ]);

  await assert.rejects(() => w.setBulbColor("M", "WLPA19C", "nope"), /HEX color/);
  await assert.rejects(() => w.setBulbColor("M", "WLPA19", "ff0000"), /does not support color/);
});

test("setBulbColorTemperature flips control mode for strips, plain write for white bulbs", async () => {
  const w = stub();
  const calls = [];
  w.runActionList = async (mac, model, pid, value, action) => {
    calls.push({ pid, value });
    return {};
  };
  w.setProperty = async (mac, model, pid, value) => {
    calls.push({ pid, value });
    return {};
  };

  // White bulb: simple property write
  await w.setBulbColorTemperature("M", "WLPA19", 3500);
  assert.deepStrictEqual(calls.pop(), { pid: "P1502", value: 3500 });

  // Mesh color bulb: action list, no control-mode flip
  calls.length = 0;
  await w.setBulbColorTemperature("M", "WLPA19C", 3500);
  assert.deepStrictEqual(calls, [{ pid: "P1502", value: 3500 }]);

  // Light strip: action list + control-mode flip to TEMPERATURE
  calls.length = 0;
  await w.setBulbColorTemperature("M", "HL_LSL", 4000);
  assert.deepStrictEqual(calls, [
    { pid: "P1502", value: 4000 },
    { pid: "P1508", value: WyzeAPI.LightControlMode.TEMPERATURE },
  ]);
});

test("setBulbAwayModeOff writes P1506='0'", async () => {
  const w = stub();
  let captured;
  w.setProperty = async (mac, model, pid, value) => {
    captured = { pid, value };
    return {};
  };
  await w.setBulbAwayModeOff("M", "WLPA19C");
  assert.deepStrictEqual(captured, { pid: "P1506", value: "0" });
});

// --- Sensors family ---------------------------------------------------------

test("getContactSensorList / getMotionSensorList filter by their respective models", async () => {
  const w = stub();
  w.getDeviceList = async () => [
    { mac: "C", product_model: "DWS3U" },
    { mac: "M", product_model: "PIR3U" },
    { mac: "X", product_model: "WYZEC1" },
  ];

  const contact = await w.getContactSensorList();
  const motion = await w.getMotionSensorList();
  assert.deepStrictEqual(contact.map((d) => d.mac), ["C"]);
  assert.deepStrictEqual(motion.map((d) => d.mac), ["M"]);
});

test("getContactSensorInfo / getMotionSensorInfo merge device-info data", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "C", product_model: "DWS3U", nickname: "Door" }];
  w.getDeviceInfo = async () => ({ data: { firmware_ver: "1.0.0" } });

  const info = await w.getContactSensorInfo("C");
  assert.strictEqual(info.mac, "C");
  assert.strictEqual(info.firmware_ver, "1.0.0");
});

test("contactSensorIsOpen / motionSensorIsMotion read device_params booleans", () => {
  const w = stub();
  assert.strictEqual(w.contactSensorIsOpen({ device_params: { open_close_state: 1 } }), true);
  assert.strictEqual(w.contactSensorIsOpen({ device_params: { open_close_state: 0 } }), false);
  assert.strictEqual(w.contactSensorIsOpen({}), null);

  assert.strictEqual(w.motionSensorIsMotion({ device_params: { motion_state: 1 } }), true);
  assert.strictEqual(w.motionSensorIsMotion({ device_params: { motion_state: 0 } }), false);
});

// --- Mixin accessors --------------------------------------------------------

test("deviceGetBattery checks every key family uses (battary, electricity, etc.)", () => {
  const w = stub();
  assert.strictEqual(w.deviceGetBattery({ battary: 87 }), 87);
  assert.strictEqual(w.deviceGetBattery({ device_params: { battary: 50 } }), 50);
  assert.strictEqual(w.deviceGetBattery({ device_params: { electricity: 75 } }), 75);
  assert.strictEqual(w.deviceGetBattery({ device_params: { battery: 60 } }), 60);
  assert.strictEqual(w.deviceGetBattery({ device_params: { voltage: 3 } }), 3);
  assert.strictEqual(w.deviceGetBattery({}), null);
});

test("deviceIsOnline tries conn_state, status, is_online, iot_state", () => {
  const w = stub();
  assert.strictEqual(w.deviceIsOnline({ conn_state: 1 }), true);
  assert.strictEqual(w.deviceIsOnline({ device_params: { status: 1 } }), true);
  assert.strictEqual(w.deviceIsOnline({ is_online: true }), true);
  assert.strictEqual(w.deviceIsOnline({ device_params: { iot_state: 1 } }), true);
  assert.strictEqual(w.deviceIsOnline({}), null);
});

test("deviceIsLowBattery applies the configured threshold", () => {
  const w = stub();
  w.lowBatteryPercentage = 25;
  assert.strictEqual(w.deviceIsLowBattery({ battary: 10 }), true);
  assert.strictEqual(w.deviceIsLowBattery({ battary: 50 }), false);
  assert.strictEqual(w.deviceIsLowBattery({}), false);
});

// --- Thermostat info -------------------------------------------------------

test("getThermostatInfo merges list entry with iot props + device info", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "T", product_model: "CO_EA1", nickname: "Hall" }];
  w.thermostatGetIotProp = async () => ({
    data: { props: { temperature: 720, humidity: 45, mode_sys: "auto" } },
  });
  w.getThermostatDeviceInfo = async () => ({
    data: { settings: { firmware_ver: "1.2.3", ssid: "wifi" } },
  });

  const info = await w.getThermostatInfo("T");
  assert.strictEqual(info.mac, "T");
  assert.strictEqual(info.temperature, 720);
  assert.strictEqual(info.mode_sys, "auto");
  assert.strictEqual(info.firmware_ver, "1.2.3");
});

test("getThermostatInfo returns null for non-thermostat mac", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "X", product_model: "WYZEC1" }];
  assert.strictEqual(await w.getThermostatInfo("X"), null);
});

// --- Lock access codes -----------------------------------------------------

test("encryptLockAccessCode uses AES-128-CBC with IV='0123456789ABCDEF' and key=md5(secret)", () => {
  const ciphertext = wyzeCrypto.encryptLockAccessCode("1234", "test-secret");

  // Reproduce manually
  const iv = Buffer.from("0123456789ABCDEF", "utf8");
  const key = nodeCrypto.createHash("md5").update("test-secret").digest();
  const cipher = nodeCrypto.createCipheriv("aes-128-cbc", key, iv);
  const expected = Buffer.concat([cipher.update("1234", "utf8"), cipher.final()]).toString("hex");

  assert.strictEqual(ciphertext, expected);
});

test("buildLockKeyPermission shapes per type", () => {
  const w = stub();
  assert.deepStrictEqual(
    w.buildLockKeyPermission(WyzeAPI.LockKeyPermissionType.ALWAYS),
    { status: 1 }
  );
  assert.deepStrictEqual(
    w.buildLockKeyPermission(WyzeAPI.LockKeyPermissionType.RECURRING),
    { status: 4, begin: 0, end: 0 }
  );
  const dur = w.buildLockKeyPermission(
    WyzeAPI.LockKeyPermissionType.DURATION,
    new Date(1700000000000),
    1700100000
  );
  assert.strictEqual(dur.status, 2);
  assert.strictEqual(dur.begin, 1700000000); // ms -> seconds
  assert.strictEqual(dur.end, 1700100000);
});

test("buildLockKeyPeriodicity formats time as HHMMSS and requires non-empty validDays", () => {
  const w = stub();
  const p = w.buildLockKeyPeriodicity({
    begin: "080000",
    end: "170000",
    validDays: [1, 2, 3, 4, 5],
  });
  assert.deepStrictEqual(p, {
    type: 2,
    interval: 1,
    begin: "080000",
    end: "170000",
    valid_days: [1, 2, 3, 4, 5],
  });

  // Date input
  const p2 = w.buildLockKeyPeriodicity({
    begin: new Date(2000, 0, 1, 9, 30),
    end: new Date(2000, 0, 1, 17, 45),
    validDays: [6, 7],
  });
  assert.strictEqual(p2.begin, "093000");
  assert.strictEqual(p2.end, "174500");

  assert.throws(
    () => w.buildLockKeyPeriodicity({ begin: "080000", end: "170000", validDays: [] }),
    /non-empty array/
  );
  assert.throws(
    () =>
      w.buildLockKeyPeriodicity({ begin: "abc", end: "170000", validDays: [1] }),
    /HHMMSS/
  );
});

test("addLockAccessCode validates PIN, fetches secret, encrypts, posts to /add", async () => {
  const w = stub();
  let captured;
  w.getLockCryptSecret = async () => ({ secret: "s" });
  w._fordPost = async (path, params, method) => {
    captured = { path, params, method };
    return {};
  };

  await w.addLockAccessCode("YD.LO1.MAC", "YD.LO1", {
    accessCode: "4321",
    name: "Guest",
    userId: "user-1",
  });
  assert.strictEqual(captured.path, "/openapi/lock/v1/pwd/operations/add");
  assert.strictEqual(captured.params.uuid, "MAC");
  assert.strictEqual(captured.params.userid, "user-1");
  assert.strictEqual(captured.params.name, "Guest");
  assert.match(captured.params.password, /^[0-9a-f]+$/);
  assert.deepStrictEqual(JSON.parse(captured.params.permission), { status: 1 });

  await assert.rejects(
    () => w.addLockAccessCode("YD.LO1.MAC", "YD.LO1", { accessCode: "12", userId: "u" }),
    /4–8 digits/
  );
  await assert.rejects(
    () => w.addLockAccessCode("YD.LO1.MAC", "YD.LO1", { accessCode: "1234" }),
    /userId is required/
  );
});

test("addLockAccessCode requires periodicity for RECURRING permission", async () => {
  const w = stub();
  w.getLockCryptSecret = async () => ({ secret: "s" });
  w._fordPost = async () => ({});

  const perm = { status: WyzeAPI.LockKeyPermissionType.RECURRING, begin: 0, end: 0 };
  await assert.rejects(
    () =>
      w.addLockAccessCode("YD.LO1.MAC", "YD.LO1", {
        accessCode: "1234",
        userId: "u",
        permission: perm,
      }),
    /periodicity is required/
  );
});

test("renameLockAccessCode uses HTTP PUT", async () => {
  const w = stub();
  let captured;
  w._fordPost = async (path, params, method) => {
    captured = { path, method };
    return {};
  };

  await w.renameLockAccessCode("YD.LO1.MAC", "YD.LO1", 42, "Cleaner");
  assert.strictEqual(captured.path, "/openapi/lock/v1/pwd/nickname");
  assert.strictEqual(captured.method, "put");
});

test("deleteLockAccessCode validates id and posts to /delete", async () => {
  const w = stub();
  let captured;
  w._fordPost = async (path, params) => {
    captured = { path, params };
    return {};
  };

  await w.deleteLockAccessCode("YD.LO1.MAC", "YD.LO1", 7);
  assert.strictEqual(captured.path, "/openapi/lock/v1/pwd/operations/delete");
  assert.strictEqual(captured.params.passwordid, "7");

  await assert.rejects(
    () => w.deleteLockAccessCode("YD.LO1.MAC", "YD.LO1", null),
    /accessCodeId is required/
  );
});
