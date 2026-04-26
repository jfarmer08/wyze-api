/**
 * Wyze Lock V1 (Ford service) — additional read methods + enum lookups.
 * Pure helpers and method-routing only; network is stubbed via _fordGet.
 */
const test = require("node:test");
const assert = require("node:assert");

const WyzeAPI = require("../src/index");

const stub = () => {
  const w = Object.create(WyzeAPI.prototype);
  w.access_token = "test-token";
  w.userAgent = "test";
  w.apiLogEnabled = false;
  w.log = { info: () => {}, error: () => {}, warning: () => {} };
  w.maybeLogin = async () => {};
  return w;
};

const lockDevice = {
  mac: "YD.LO1.ABCDEF1234567890",
  product_model: "YD.LO1",
  nickname: "Front Door",
};

test("parseLockStatus maps codes to names", () => {
  assert.strictEqual(WyzeAPI.parseLockStatus(-1), "Offline");
  assert.strictEqual(WyzeAPI.parseLockStatus(1), "Locked");
  assert.strictEqual(WyzeAPI.parseLockStatus(3), "Unlocked");
  assert.strictEqual(WyzeAPI.parseLockStatus(99), null);
  assert.strictEqual(WyzeAPI.parseLockStatus(null), null);
});

test("parseLockEventType maps lock event codes to descriptions", () => {
  assert.strictEqual(WyzeAPI.parseLockEventType(2203), "Unlocked");
  assert.strictEqual(WyzeAPI.parseLockEventType(2216), "Locked");
  assert.strictEqual(WyzeAPI.parseLockEventType(2221), "Jammed");
  assert.strictEqual(WyzeAPI.parseLockEventType(9999), null);
});

test("parseLockEventSource handles single and multi-code groups (KEYPAD = [2,102])", () => {
  assert.strictEqual(WyzeAPI.parseLockEventSource(1), "LOCAL");
  assert.strictEqual(WyzeAPI.parseLockEventSource(2), "KEYPAD");
  assert.strictEqual(WyzeAPI.parseLockEventSource(102), "KEYPAD");
  assert.strictEqual(WyzeAPI.parseLockEventSource(3), "FINGERPRINT");
  assert.strictEqual(WyzeAPI.parseLockEventSource(9), "REMOTE");
  assert.strictEqual(WyzeAPI.parseLockEventSource(50), null);
});

test("module exports expose lock enums", () => {
  assert.strictEqual(WyzeAPI.LockStatusType.LOCKED, 1);
  assert.strictEqual(WyzeAPI.LockEventType.UNLOCKED, 2203);
  assert.strictEqual(WyzeAPI.LockVolumeLevel.NORMAL, 50);
  assert.strictEqual(WyzeAPI.LockKeyType.ACCESS_CODE, 2);
  assert.strictEqual(WyzeAPI.LockKeyPermissionType.RECURRING, 4);
  assert.strictEqual(WyzeAPI.LockLeftOpenTime.MIN_5, 3);
});

test("getLockDeviceList filters by YD.LO1", async () => {
  const w = stub();
  w.getDeviceList = async () => [
    { mac: "X", product_model: "WYZEC1" },
    { mac: "Y", product_model: "YD.LO1" },
    { mac: "Z", product_model: "YD.GW1" },
  ];
  const locks = await w.getLockDeviceList();
  assert.deepStrictEqual(locks.map((d) => d.mac), ["Y"]);
});

test("getLockGatewayList filters by YD.GW1", async () => {
  const w = stub();
  w.getDeviceList = async () => [
    { mac: "X", product_model: "WYZEC1" },
    { mac: "Y", product_model: "YD.LO1" },
    { mac: "Z", product_model: "YD.GW1" },
  ];
  const gateways = await w.getLockGatewayList();
  assert.deepStrictEqual(gateways.map((d) => d.mac), ["Z"]);
});

test("getLockKeypadInfo / getLockGatewayInfo / getLockKeys hit the right paths with uuid", async () => {
  const w = stub();
  const calls = [];
  w._fordGet = async (path, params) => {
    calls.push({ path, params });
    return {};
  };

  await w.getLockKeypadInfo(lockDevice.mac, lockDevice.product_model);
  await w.getLockGatewayInfo("YD.GW1.GATEWAY1234567890", "YD.GW1");
  await w.getLockKeys(lockDevice.mac, lockDevice.product_model);

  assert.strictEqual(calls[0].path, "/openapi/keypad/v1/info");
  assert.strictEqual(calls[0].params.uuid, "ABCDEF1234567890");
  assert.strictEqual(calls[1].path, "/openapi/gateway/v1/info");
  assert.strictEqual(calls[1].params.uuid, "GATEWAY1234567890");
  assert.strictEqual(calls[2].path, "/openapi/lock/v1/pwd");
  assert.strictEqual(calls[2].params.uuid, "ABCDEF1234567890");
});

test("getLockCryptSecret hits /openapi/v1/crypt_secret with no params", async () => {
  const w = stub();
  let captured;
  w._fordGet = async (path, params) => {
    captured = { path, params };
    return { secret: "deadbeef" };
  };
  const result = await w.getLockCryptSecret();
  assert.strictEqual(captured.path, "/openapi/v1/crypt_secret");
  // No params required for this endpoint; nothing meaningful is sent.
  assert.ok(captured.params == null || Object.keys(captured.params).length === 0);
  assert.strictEqual(result.secret, "deadbeef");
});

test("getLockRecordCount sends begin (and optional end) as epoch-ms strings", async () => {
  const w = stub();
  const calls = [];
  w._fordGet = async (path, params) => {
    calls.push({ path, params });
    return { cnt: 42 };
  };

  const since = new Date(1700000000000);
  await w.getLockRecordCount(lockDevice.mac, lockDevice.product_model, since);
  await w.getLockRecordCount(lockDevice.mac, lockDevice.product_model, since, 1700100000000);

  assert.strictEqual(calls[0].path, "/openapi/v1/safety/count");
  assert.strictEqual(calls[0].params.begin, "1700000000000");
  assert.strictEqual(calls[0].params.end, undefined);
  assert.strictEqual(calls[1].params.begin, "1700000000000");
  assert.strictEqual(calls[1].params.end, "1700100000000");
});

test("getLockRecords sends begin/limit/offset as strings; throws when since is missing", async () => {
  const w = stub();
  const calls = [];
  w._fordGet = async (path, params) => {
    calls.push({ path, params });
    return {};
  };

  await w.getLockRecords(lockDevice.mac, lockDevice.product_model, { since: 1700000000000 });
  assert.strictEqual(calls[0].path, "/openapi/v1/safety/family_record");
  assert.strictEqual(calls[0].params.begin, "1700000000000");
  assert.strictEqual(calls[0].params.limit, "20"); // default
  assert.strictEqual(calls[0].params.offset, "0"); // default

  await w.getLockRecords(lockDevice.mac, lockDevice.product_model, {
    since: new Date(1700000000000),
    until: 1700100000000,
    limit: 5,
    offset: 10,
  });
  assert.strictEqual(calls[1].params.begin, "1700000000000");
  assert.strictEqual(calls[1].params.end, "1700100000000");
  assert.strictEqual(calls[1].params.limit, "5");
  assert.strictEqual(calls[1].params.offset, "10");

  await assert.rejects(
    () => w.getLockRecords(lockDevice.mac, lockDevice.product_model, {}),
    /`since` is required/
  );
});

test("getLockFullInfo merges list entry, lock info, secret, and record count", async () => {
  const w = stub();
  w.getDeviceList = async () => [lockDevice];
  w.getLockInfo = async () => ({ device: { online: 1, power: 87 } });
  w.getLockCryptSecret = async () => ({ secret: "topsecret" });
  w.getLockRecordCount = async () => ({ cnt: 7 });

  const info = await w.getLockFullInfo(lockDevice.mac);
  assert.strictEqual(info.mac, lockDevice.mac);
  assert.strictEqual(info.nickname, "Front Door");
  assert.strictEqual(info.device_params.online, 1);
  assert.strictEqual(info.device_params.power, 87);
  assert.strictEqual(info.secret, "topsecret");
  assert.strictEqual(info.record_count, 7);
});

test("getLockFullInfo returns null when mac is not a lock", async () => {
  const w = stub();
  w.getDeviceList = async () => [{ mac: "OTHER", product_model: "WYZEC1" }];
  assert.strictEqual(await w.getLockFullInfo("MISSING"), null);
});

test("getLockFullInfo tolerates partial sub-fetch failures", async () => {
  const w = stub();
  w.getDeviceList = async () => [lockDevice];
  w.getLockInfo = async () => {
    throw new Error("boom");
  };
  w.getLockCryptSecret = async () => ({ secret: "ok" });
  w.getLockRecordCount = async () => {
    throw new Error("boom");
  };

  const info = await w.getLockFullInfo(lockDevice.mac);
  assert.strictEqual(info.mac, lockDevice.mac);
  assert.strictEqual(info.secret, "ok");
  assert.strictEqual(info.record_count, undefined);
});

test("device-object helpers forward to the right mac/model methods", async () => {
  const w = stub();
  const calls = [];
  w._fordGet = async (path, params) => {
    calls.push(path);
    return {};
  };

  await w.lockKeypad(lockDevice);
  await w.lockGateway(lockDevice);
  await w.lockRecords(lockDevice, { since: 1700000000000 });
  await w.lockKeys(lockDevice);

  assert.deepStrictEqual(calls, [
    "/openapi/keypad/v1/info",
    "/openapi/gateway/v1/info",
    "/openapi/v1/safety/family_record",
    "/openapi/lock/v1/pwd",
  ]);
});
