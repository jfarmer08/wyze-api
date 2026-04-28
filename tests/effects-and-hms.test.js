/**
 * Light visual effects + HMS request helper.
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

// --- Visual effects ---------------------------------------------------------

test("module exports expose LightVisualEffectModel + RunType", () => {
  assert.strictEqual(WyzeAPI.LightVisualEffectModel.STARSHINE, "9");
  assert.strictEqual(WyzeAPI.LightVisualEffectRunType.DIRECTION_GATHERED, "2");
  assert.ok(
    WyzeAPI.LightVisualEffectModelsWithDirection.includes(
      WyzeAPI.LightVisualEffectModel.MARQUEE
    )
  );
});

test("buildLightVisualEffect produces the expected plist (model + defaults)", () => {
  const w = stub();
  const plist = w.buildLightVisualEffect({ model: WyzeAPI.LightVisualEffectModel.GRADUAL_CHANGE });

  // Order matters for the plist (matches what the Wyze app sends).
  assert.deepStrictEqual(plist.map((p) => p.pid), [
    "P1522", "P1535", "P1536", "P1524", "P1516", "P1525", "P1526",
  ]);
  // Default values
  assert.strictEqual(plist[0].pvalue, "1"); // model id
  assert.strictEqual(plist[1].pvalue, "0"); // music_mode false
  assert.strictEqual(plist[2].pvalue, "8"); // speed default
  assert.strictEqual(plist[3].pvalue, "100"); // sensitivity default
  assert.strictEqual(plist[5].pvalue, "0"); // auto_color false
  assert.strictEqual(plist[6].pvalue, "2961AF,B5267A,91FF6A"); // default palette
});

test("buildLightVisualEffect appends run_type only for direction-supporting models", () => {
  const w = stub();
  // GRADUAL_CHANGE doesn't support direction → run_type ignored
  const a = w.buildLightVisualEffect({
    model: WyzeAPI.LightVisualEffectModel.GRADUAL_CHANGE,
    runType: WyzeAPI.LightVisualEffectRunType.DIRECTION_LEFT,
  });
  assert.ok(!a.find((p) => p.pid === "P1523"));

  // MARQUEE does → run_type appended
  const b = w.buildLightVisualEffect({
    model: WyzeAPI.LightVisualEffectModel.MARQUEE,
    runType: WyzeAPI.LightVisualEffectRunType.DIRECTION_DISPERSIVE,
  });
  const runProp = b.find((p) => p.pid === "P1523");
  assert.strictEqual(runProp.pvalue, "1");
});

test("buildLightVisualEffect rejects bad inputs", () => {
  const w = stub();
  assert.throws(() => w.buildLightVisualEffect({ model: "99" }), /invalid model/);
  assert.throws(
    () =>
      w.buildLightVisualEffect({
        model: WyzeAPI.LightVisualEffectModel.MARQUEE,
        runType: "9",
      }),
    /invalid runType/
  );
  assert.throws(
    () =>
      w.buildLightVisualEffect({
        model: WyzeAPI.LightVisualEffectModel.GRADUAL_CHANGE,
        speed: 99,
      }),
    /speed must be an integer 1-10/
  );
  assert.throws(
    () =>
      w.buildLightVisualEffect({
        model: WyzeAPI.LightVisualEffectModel.GRADUAL_CHANGE,
        sensitivity: 200,
      }),
    /sensitivity must be 0-100/
  );
});

test("setBulbEffect rejects non-light-strip models, sends to set_mesh_property with FRAGMENTED control mode", async () => {
  const w = stub();
  let captured;
  w.runActionListMulti = async (mac, model, plist, actionKey) => {
    captured = { mac, model, plist, actionKey };
    return {};
  };

  await w.setBulbEffect("M", "HL_LSL", {
    model: WyzeAPI.LightVisualEffectModel.SEA_WAVE,
    runType: WyzeAPI.LightVisualEffectRunType.DIRECTION_LEFT,
    speed: 5,
  });

  assert.strictEqual(captured.actionKey, "set_mesh_property");
  // Last entry should be the control-mode flip to FRAGMENTED (3)
  const lastProp = captured.plist[captured.plist.length - 1];
  assert.strictEqual(lastProp.pid, "P1508");
  assert.strictEqual(lastProp.pvalue, "3");

  await assert.rejects(
    () =>
      w.setBulbEffect("M", "WLPA19", {
        model: WyzeAPI.LightVisualEffectModel.GRADUAL_CHANGE,
      }),
    /not a light strip/
  );
});

test("runActionListMulti sends the full plist (no auto-P3 push)", async () => {
  const w = stub();
  let captured;
  w.request = async (path, data) => {
    captured = { path, data };
    return { data: {} };
  };

  await w.runActionListMulti(
    "M",
    "HL_LSL",
    [
      { pid: "P1522", pvalue: "3" },
      { pid: "P1536", pvalue: "5" },
    ],
    "set_mesh_property"
  );

  assert.strictEqual(captured.path, "app/v2/auto/run_action_list");
  const sentPlist = captured.data.action_list[0].action_params.list[0].plist;
  assert.deepStrictEqual(sentPlist, [
    { pid: "P1522", pvalue: "3" },
    { pid: "P1536", pvalue: "5" },
  ]);
});

test("bulbEffect device-object helper forwards to setBulbEffect", async () => {
  const w = stub();
  let captured;
  w.setBulbEffect = async (mac, model, opts) => {
    captured = { mac, model, opts };
    return {};
  };

  await w.bulbEffect(
    { mac: "M", product_model: "HL_LSL" },
    { model: WyzeAPI.LightVisualEffectModel.JUMP }
  );
  assert.strictEqual(captured.mac, "M");
  assert.strictEqual(captured.model, "HL_LSL");
  assert.strictEqual(captured.opts.model, "2");
});

// --- HMS request -----------------------------------------------------------

test("disableRemeAlarm uses _hmsRequest with DELETE + body, no signing", async () => {
  const w = stub();
  let captured;
  w._hmsRequest = async (method, url, options) => {
    captured = { method, url, options };
    return {};
  };

  await w.disableRemeAlarm("hms-123");
  assert.strictEqual(captured.method, "delete");
  assert.match(captured.url, /reme-alarm/);
  assert.deepStrictEqual(captured.options.body, {
    hms_id: "hms-123",
    remediation_id: "emergency",
  });
  assert.notStrictEqual(captured.options.sign, true); // no signing
});

test("monitoringProfileStateStatus uses _hmsRequest with GET + sign + contentType", async () => {
  const w = stub();
  let captured;
  w._hmsRequest = async (method, url, options) => {
    captured = { method, url, options };
    return {};
  };

  await w.monitoringProfileStateStatus("hms-123");
  assert.strictEqual(captured.method, "get");
  assert.match(captured.url, /state-status/);
  assert.strictEqual(captured.options.sign, true);
  assert.strictEqual(captured.options.contentType, true);
  assert.ok(captured.options.params);
});

test("monitoringProfileActive uses _hmsRequest with PATCH + sign + body array", async () => {
  const w = stub();
  let captured;
  w._hmsRequest = async (method, url, options) => {
    captured = { method, url, options };
    return {};
  };

  await w.monitoringProfileActive("hms-123", 1, 0);
  assert.strictEqual(captured.method, "patch");
  assert.match(captured.url, /profile\/active/);
  assert.strictEqual(captured.options.sign, true);
  assert.deepStrictEqual(captured.options.body, [
    { state: "home", active: 1 },
    { state: "away", active: 0 },
  ]);
});
