/**
 * Thermostat typed setters + multi-write helpers + enum exports.
 * Network is stubbed via thermostatSetIotProp.
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

const thermostat = { mac: "CO_EA1.ABCDEF", product_model: "CO_EA1", nickname: "Hallway" };

test("module exports expose thermostat enums", () => {
  assert.strictEqual(WyzeAPI.ThermostatSystemMode.AUTO, "auto");
  assert.strictEqual(WyzeAPI.ThermostatSystemMode.OFF, "off");
  assert.strictEqual(WyzeAPI.ThermostatFanMode.CYCLE, "circ");
  assert.strictEqual(WyzeAPI.ThermostatScenarioType.AWAY, "away");
  assert.strictEqual(WyzeAPI.ThermostatWorkingState.HEATING, "heating");
  assert.strictEqual(WyzeAPI.ThermostatTempUnit.FAHRENHEIT, "F");
  assert.strictEqual(WyzeAPI.ThermostatComfortBalanceMode.BALANCE, 3);
  assert.strictEqual(WyzeAPI.ThermostatComfortBalanceDescription[5], "Maximum comfort");
  assert.strictEqual(WyzeAPI.RoomSensorBatteryLevel.FULL, 4);
  assert.strictEqual(WyzeAPI.RoomSensorStatusType.AUTO_UP, "auto_up");
  assert.strictEqual(WyzeAPI.RoomSensorStateType.ONLINE, "connect");
});

test("setThermostatSystemMode validates and writes mode_sys", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.setThermostatSystemMode(thermostat.mac, thermostat.product_model, "auto");
  await w.setThermostatSystemMode(thermostat.mac, thermostat.product_model, "off");
  assert.deepStrictEqual(calls, [
    { key: "mode_sys", value: "auto" },
    { key: "mode_sys", value: "off" },
  ]);

  await assert.rejects(
    () => w.setThermostatSystemMode(thermostat.mac, thermostat.product_model, "warp"),
    /not a valid value/
  );
});

test("setThermostatFanMode validates and writes fan_mode", async () => {
  const w = stub();
  let captured;
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    captured = { key, value };
    return {};
  };

  await w.setThermostatFanMode(thermostat.mac, thermostat.product_model, "circ");
  assert.deepStrictEqual(captured, { key: "fan_mode", value: "circ" });

  await assert.rejects(
    () => w.setThermostatFanMode(thermostat.mac, thermostat.product_model, "high"),
    /not a valid value/
  );
});

test("setThermostatScenario validates and writes current_scenario", async () => {
  const w = stub();
  let captured;
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    captured = { key, value };
    return {};
  };

  await w.setThermostatScenario(thermostat.mac, thermostat.product_model, "home");
  assert.deepStrictEqual(captured, { key: "current_scenario", value: "home" });

  await assert.rejects(
    () => w.setThermostatScenario(thermostat.mac, thermostat.product_model, "vacation"),
    /not a valid value/
  );
});

test("setpoint setters require integer tenths-of-°F", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.setThermostatHeatingSetpoint(thermostat.mac, thermostat.product_model, 680);
  await w.setThermostatCoolingSetpoint(thermostat.mac, thermostat.product_model, 740);
  assert.deepStrictEqual(calls, [
    { key: "heat_sp", value: 680 },
    { key: "cool_sp", value: 740 },
  ]);

  await assert.rejects(
    () => w.setThermostatHeatingSetpoint(thermostat.mac, thermostat.product_model, 68.5),
    /must be an integer/
  );
  await assert.rejects(
    () => w.setThermostatCoolingSetpoint(thermostat.mac, thermostat.product_model, "74"),
    /must be an integer/
  );
});

test("setThermostatTemperature writes both setpoints in cool→heat order", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.setThermostatTemperature(thermostat.mac, thermostat.product_model, 740, 680);
  assert.deepStrictEqual(calls, [
    { key: "cool_sp", value: 740 },
    { key: "heat_sp", value: 680 },
  ]);
});

test("setThermostatLock maps boolean to '1' / '0' string for kid_lock", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.setThermostatLock(thermostat.mac, thermostat.product_model, true);
  await w.setThermostatLock(thermostat.mac, thermostat.product_model, false);
  assert.deepStrictEqual(calls, [
    { key: "kid_lock", value: "1" },
    { key: "kid_lock", value: "0" },
  ]);
});

test("setThermostatComfortBalance validates and writes save_comfort_balance", async () => {
  const w = stub();
  let captured;
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    captured = { key, value };
    return {};
  };

  await w.setThermostatComfortBalance(
    thermostat.mac,
    thermostat.product_model,
    WyzeAPI.ThermostatComfortBalanceMode.MAX_COMFORT
  );
  assert.deepStrictEqual(captured, { key: "save_comfort_balance", value: 5 });

  await assert.rejects(
    () => w.setThermostatComfortBalance(thermostat.mac, thermostat.product_model, 99),
    /not a valid value/
  );
});

test("holdThermostat writes dev_hold='1' then dev_holdtime epoch ms", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  const until = new Date(1700000000000);
  await w.holdThermostat(thermostat.mac, thermostat.product_model, until);
  assert.deepStrictEqual(calls, [
    { key: "dev_hold", value: "1" },
    { key: "dev_holdtime", value: "1700000000000" },
  ]);

  // epoch ms also accepted
  calls.length = 0;
  await w.holdThermostat(thermostat.mac, thermostat.product_model, 1700100000000);
  assert.deepStrictEqual(calls, [
    { key: "dev_hold", value: "1" },
    { key: "dev_holdtime", value: "1700100000000" },
  ]);

  await assert.rejects(
    () => w.holdThermostat(thermostat.mac, thermostat.product_model, "later"),
    /must be a Date or epoch ms/
  );
});

test("clearThermostatHold writes dev_hold='0'", async () => {
  const w = stub();
  let captured;
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    captured = { key, value };
    return {};
  };

  await w.clearThermostatHold(thermostat.mac, thermostat.product_model);
  assert.deepStrictEqual(captured, { key: "dev_hold", value: "0" });
});

test("device-object helpers forward to mac/model methods", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.thermostatSystemMode(thermostat, "cool");
  await w.thermostatFanMode(thermostat, "on");
  await w.thermostatScenario(thermostat, "sleep");
  await w.thermostatHeatingSetpoint(thermostat, 680);
  await w.thermostatCoolingSetpoint(thermostat, 740);
  await w.thermostatLock(thermostat, true);
  await w.thermostatComfortBalance(thermostat, WyzeAPI.ThermostatComfortBalanceMode.MAX_SAVINGS);
  await w.thermostatClearHold(thermostat);

  assert.deepStrictEqual(calls, [
    { key: "mode_sys", value: "cool" },
    { key: "fan_mode", value: "on" },
    { key: "current_scenario", value: "sleep" },
    { key: "heat_sp", value: 680 },
    { key: "cool_sp", value: 740 },
    { key: "kid_lock", value: "1" },
    { key: "save_comfort_balance", value: 1 },
    { key: "dev_hold", value: "0" },
  ]);
});

test("thermostatTemperature(device, cool, heat) wraps setThermostatTemperature", async () => {
  const w = stub();
  const calls = [];
  w.thermostatSetIotProp = async (mac, model, key, value) => {
    calls.push({ key, value });
    return {};
  };

  await w.thermostatTemperature(thermostat, 740, 680);
  assert.deepStrictEqual(calls, [
    { key: "cool_sp", value: 740 },
    { key: "heat_sp", value: 680 },
  ]);
});
