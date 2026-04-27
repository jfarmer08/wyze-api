// Wyze property IDs (PIDs). Names reflect each property's purpose in our
// public methods (e.g. P1001 → MOTION_DETECTION matches cameraMotionOn/Off).
//
// P1056 is shared between the camera flood light and spotlight (devices
// only expose one of the two physically) — kept under CAMERA_FLOOD_LIGHT
// for backwards compatibility.
const propertyIds = Object.freeze({
  NOTIFICATION: "P1",         // CameraProps / SensorProps notification
  ON: "P3",                   // SwitchableMixin on/off
  AVAILABLE: "P5",            // online
  MOTION_DETECTION: "P1001",  // cameraMotion*
  MOTION_RECORDING: "P1047",  // CameraProps motion_alarm_enable
  SOUND_NOTIFICATION: "P1048",// CameraProps sound_alarm_enable
  CAMERA_SIREN: "P1049",
  CAMERA_FLOOD_LIGHT: "P1056",// also used for spotlight (P1056 is shared)
  BRIGHTNESS: "P1501",        // LightProps brightness
  COLOR_TEMP: "P1502",        // LightProps color_temp
  COLOR: "P1507",             // LightProps color (HEX RGB)
  CONTROL_LIGHT: "P1508",     // LightProps control_light (LightControlMode)
  POWER_LOSS_RECOVERY: "P1509", // LightProps power_loss_recovery
  SUN_MATCH: "P1528",         // LightProps sun_match (mimic sunlight CCT)
  AWAY_MODE: "P1506",         // LightProps away_mode (light vacation mode)
});

// Documented value sets for the PIDs above. Use these instead of inline
// strings when the value isn't self-evident — e.g. CAMERA_FLOOD_LIGHT
// uses "1"/"2" not "1"/"0", and a future reader of `..., "2")` won't
// know which one means "off".
//
// PIDs not listed here use straightforward "1"/"0" or numeric ranges
// (BRIGHTNESS = 1–100, COLOR_TEMP = 2700–6500K, COLOR = HEX RGB string).
const propertyValues = Object.freeze({
  // P3 / SwitchableMixin on/off — strings in this codebase
  ON: Object.freeze({ ON: "1", OFF: "0" }),

  // P1 / camera + sensor notification toggle
  NOTIFICATION: Object.freeze({ ON: "1", OFF: "0" }),

  // P1001 / camera motion detection — numeric in this codebase
  MOTION_DETECTION: Object.freeze({ ON: 1, OFF: 0 }),

  // P1047 / camera motion recording (event recording motion record enabled)
  MOTION_RECORDING: Object.freeze({ ON: "1", OFF: "0" }),

  // P1048 / camera sound notification (event recording sound record enabled)
  SOUND_NOTIFICATION: Object.freeze({ ON: "1", OFF: "0" }),

  // P1056 / camera floodlight + spotlight — NOTE: OFF is "2", not "0"
  CAMERA_FLOOD_LIGHT: Object.freeze({ ON: "1", OFF: "2" }),

  // P1049 / camera siren — same shape as floodlight on Wyze devices
  CAMERA_SIREN: Object.freeze({ ON: "1", OFF: "2" }),
});

// Master product_model registry. Single source of truth for product_model
// -> family. Aggregate keys (CAMERA, BULB, PLUG, MESH_BULB, LIGHT_STRIP,
// SCALE) are computed from their components.
const _CAMERA_V1 = ["WYZEC1"];
const _CAMERA_V2 = ["WYZEC1-JZ"];
const _CAMERA_V3 = ["WYZE_CAKP2JFUS"];
const _CAMERA_OUTDOOR = ["WVOD1"];

const _BULB_WHITE = ["WLPA19"];
const _BULB_WHITE_V2 = ["HL_HWB2"];
const _LIGHT_STRIP_PRO = ["HL_LSLP"];
const _LIGHT_STRIP = ["HL_LSL", ..._LIGHT_STRIP_PRO];
const _MESH_BULB = ["WLPA19C", ..._LIGHT_STRIP];

const _SCALE_ = ["JA.SC", "JA.SC2"];
const _SCALE_S = ["WL_SC2"];
const _SCALE_X = ["WL_SC3"];

const _OUTDOOR_PLUG = ["WLPPO", "WLPPO-SUB"];

const DeviceModels = Object.freeze({
  CAMERA_V1: _CAMERA_V1,
  CAMERA_V2: _CAMERA_V2,
  CAMERA_V3: _CAMERA_V3,
  CAMERA_OUTDOOR: _CAMERA_OUTDOOR,
  CAMERA: [..._CAMERA_V1, ..._CAMERA_V2, ..._CAMERA_V3, ..._CAMERA_OUTDOOR],

  LOCK: ["YD.LO1"],
  LOCK_GATEWAY: ["YD.GW1"],
  LOCK_BOLT_V2: ["DX_LB2"],
  LOCK_PALM: ["DX_PVLOC"],

  THERMOSTAT: ["CO_EA1"],
  THERMOSTAT_ROOM_SENSOR: ["CO_TH1"],

  CONTACT_SENSOR: ["DWS3U", "DWS2U"],
  MOTION_SENSOR: ["PIR3U", "PIR2U"],

  VACUUM: ["JA_RO2"],

  SCALE_: _SCALE_,
  SCALE_S: _SCALE_S,
  SCALE_X: _SCALE_X,
  SCALE: [..._SCALE_, ..._SCALE_S, ..._SCALE_X],

  WATCH: ["RA.WP1", "RY.WA1"],
  BAND: ["RY.HP1"],

  BULB_WHITE: _BULB_WHITE,
  BULB_WHITE_V2: _BULB_WHITE_V2,
  LIGHT_STRIP_PRO: _LIGHT_STRIP_PRO,
  LIGHT_STRIP: _LIGHT_STRIP,
  MESH_BULB: _MESH_BULB,
  BULB: [..._BULB_WHITE, ..._BULB_WHITE_V2, ..._MESH_BULB],

  OUTDOOR_PLUG: _OUTDOOR_PLUG,
  PLUG: ["WLPP1", "WLPP1CFH", ..._OUTDOOR_PLUG],

  SWITCH: ["LD_SS1"],
});

const wyzeWallSwitch = {
  CLASSIC: 1, // Classic Control
  IOT: 2, // Smart Control
};

const wyzeColorProperty = {
  WYZE_COLOR_TEMP_MIN: 2700,
  WYZE_COLOR_TEMP_MAX: 6500,
};

const homeKitColorProperty = {
  HOMEKIT_COLOR_TEMP_MIN: 500,
  HOMEKIT_COLOR_TEMP_MAX: 140,
};

const wyze2HomekitUnits = {
  C: 0,
  F: 1,
};

const wyze2HomekitStates = {
  off: 0,
  heat: 1,
  cool: 2,
  auto: 3,
};

const wyze2HomekitWorkingStates = {
  idle: 0,
  heating: 1,
  cooling: 2,
};

const GET_PAYLOAD = new Set(["param_info"]);

// Wyze Light/Bulb — codes used by mesh bulbs and light strips.

// Mesh-bulb / light-strip color control mode. Written to P1508. Strip-aware
// setters flip this mode so the strip switches to the right behavior.
const LightControlMode = Object.freeze({
  COLOR: 1,
  TEMPERATURE: 2,
  FRAGMENTED: 3, // visual effects / scenes
});

// Behavior on power restore after an outage. Written to P1509.
const LightPowerLossRecoveryMode = Object.freeze({
  POWER_ON: 0,                  // turn the light on
  RESTORE_PREVIOUS_STATE: 1,    // maintain previous state
});

// Wyze Lock (V1, YD.LO1) — code/description tables.
// Codes are wire values (Wyze API integers); descriptions are the human
// strings used in the Wyze app. Use `parseLockStatus(code)` etc. for
// code-to-name lookup.

const LockStatusType = Object.freeze({
  OFFLINE: -1,
  CONNECTING: 0,
  LOCKED: 1,
  LOCKING: 2,
  UNLOCKED: 3,
  UNLOCKING: 4,
  UNCALIBRATED: 5,
});

const LockStatusDescription = Object.freeze({
  [-1]: "Offline",
  0: "Connecting",
  1: "Locked",
  2: "Locking",
  3: "Unlocked",
  4: "Unlocking",
  5: "Uncalibrated",
});

function parseLockStatus(code) {
  if (typeof code !== "number") return null;
  return LockStatusDescription[code] ?? null;
}

const LockEventType = Object.freeze({
  UNLOCKED: 2203,
  OPENED: 2214,
  CLOSED: 2215,
  LOCKED: 2216,
  OPEN_TOO_LONG: 2218,
  JAMMED: 2221,
  TOTALLY_JAMMED: 2222,
  SWUNG_OPEN: 2223,
  KEPT_OPEN: 2224,
  TRASH_MODE: 2225,
  AUTO_CALIBRATED: 2226,
});

const LockEventTypeDescription = Object.freeze({
  2203: "Unlocked",
  2214: "Opened",
  2215: "Closed",
  2216: "Locked",
  2218: "Open too long",
  2221: "Jammed",
  2222: "Totally jammed",
  2223: "Swung open",
  2224: "Kept open longer than 24 hours",
  2225: "Trash mode",
  2226: "Auto-calibrated",
});

function parseLockEventType(code) {
  if (typeof code !== "number") return null;
  return LockEventTypeDescription[code] ?? null;
}

// Lock event source — one source name can map to multiple codes (KEYPAD = [2, 102]).
const LockEventSourceCodes = Object.freeze({
  LOCAL: [1],          // "App"
  KEYPAD: [2, 102],
  FINGERPRINT: [3],
  INSIDE_BUTTON: [4],
  MANUAL: [5],
  INSIDE_HOLDER: [6],
  NFC: [7],
  AUTO: [8],
  REMOTE: [9],
});

const LockEventSourceDescription = Object.freeze({
  LOCAL: "App",
  KEYPAD: "Keypad",
  FINGERPRINT: "Fingerprint",
  INSIDE_BUTTON: "Inside button",
  MANUAL: "Manual",
  INSIDE_HOLDER: "Inside holder",
  NFC: "NFC",
  AUTO: "Auto",
  REMOTE: "Remote",
});

function parseLockEventSource(code) {
  if (typeof code !== "number") return null;
  for (const [name, codes] of Object.entries(LockEventSourceCodes)) {
    if (codes.includes(code)) return name;
  }
  return null;
}

const LockVolumeLevel = Object.freeze({
  OFF: 0,
  NORMAL: 50,
  HIGH: 100,
});

const LockLeftOpenTime = Object.freeze({
  IMMEDIATE: 1,
  MIN_1: 2,
  MIN_5: 3,
  MIN_10: 4,
  MIN_30: 5,
  MIN_60: 6,
});

const LockKeyType = Object.freeze({
  BLUETOOTH: 1,
  ACCESS_CODE: 2,
  FINGERPRINT: 3,
});

const LockKeyState = Object.freeze({
  INIT: 1,
  IN_USE: 2,
  WILL_USE: 3,
  OUT_OF_PERMISSION: 4,
  FROZEN: 5,
});

const LockKeyOperation = Object.freeze({
  ADD: 1,
  DELETE: 2,
  UPDATE: 3,
  FREEZE: 4,
  UNFREEZE: 5,
});

const LockKeyOperationStage = Object.freeze({
  PENDING: 1,
  FAILURE: 2,
  SUCCESS: 3,
});

const LockKeyPermissionType = Object.freeze({
  ALWAYS: 1,
  DURATION: 2,
  ONCE: 3,
  RECURRING: 4,
});

// Wyze Thermostat (CO_EA1) — IoT prop value enums for typed setters.

const ThermostatSystemMode = Object.freeze({
  AUTO: "auto",
  COOL: "cool",
  HEAT: "heat",
  OFF: "off",
});

const ThermostatFanMode = Object.freeze({
  AUTO: "auto",
  CYCLE: "circ",
  ON: "on",
});

const ThermostatScenarioType = Object.freeze({
  HOME: "home",
  AWAY: "away",
  SLEEP: "sleep",
});

// Read-only — current operational state of the system.
const ThermostatWorkingState = Object.freeze({
  IDLE: "idle",
  HEATING: "heating",
  COOLING: "cooling",
});

const ThermostatTempUnit = Object.freeze({
  FAHRENHEIT: "F",
  CELSIUS: "C",
});

// Comfort-balance behavior — Settings -> Behavior. Written to save_comfort_balance.
const ThermostatComfortBalanceMode = Object.freeze({
  MAX_SAVINGS: 1,
  SUSTAINABILITY: 2,
  BALANCE: 3,
  BETTER_COMFORT: 4,
  MAX_COMFORT: 5,
});

const ThermostatComfortBalanceDescription = Object.freeze({
  1: "Maximum savings",
  2: "Sustainability",
  3: "Balance comfort and savings",
  4: "Weighted comfort balance",
  5: "Maximum comfort",
});

// Room Sensor (CO_TH1) — battery level + comfort-control inclusion + connectivity.
const RoomSensorBatteryLevel = Object.freeze({
  EMPTY: 1,
  LOW: 2,
  HALF: 3,
  FULL: 4,
});

const RoomSensorStatusType = Object.freeze({
  AUTO_UP: "auto_up",                // included in comfort control
  MANUAL_UP: "manual_up",            // manually included
  MANUAL_DOWN: "manual_down",        // manually excluded
});

const RoomSensorStateType = Object.freeze({
  ONLINE: "connect",
  OFFLINE: "",
});

// Wyze Robot Vacuum (Venus service) — control type / value / status /
// suction level codes.

const VacuumControlType = Object.freeze({
  GLOBAL_SWEEPING: 0,
  RETURN_TO_CHARGING: 3,
  AREA_CLEAN: 6,
  QUICK_MAPPING: 7,
});

const VacuumControlValue = Object.freeze({
  STOP: 0,
  START: 1,
  PAUSE: 2,
  FALSE_PAUSE: 3,
});

const VacuumStatus = Object.freeze({
  STANDBY: 1,
  CLEANING: 2,
  RETURNING_TO_CHARGE: 3,
  DOCKED: 4,
  MAPPING: 5,
  PAUSED: 6,
  ERROR: 7,
});

const VacuumSuctionLevel = Object.freeze({
  QUIET: 1,
  STANDARD: 2,
  STRONG: 3,
});

// Preference control types for set_iot_action / set_preference (ctrltype).
const VacuumPreferenceType = Object.freeze({
  SUCTION: 1,
});

// Vacuum mode codes — one mode value can map to many codes (firmware/hardware
// variants), so this is a many-to-one lookup. Sourced from the Wyze Android
// app (com.wyze.sweeprobot).
const VacuumModeCodes = Object.freeze({
  IDLE: [0, 14, 29, 35, 40],
  CLEANING: [1, 30, 1101, 1201, 1301, 1401],
  PAUSED: [4, 31, 1102, 1202, 1302, 1402],
  RETURNING_TO_CHARGE: [5],
  PAUSE: [9, 27, 37],
  FINISHED_RETURNING_TO_CHARGE: [10, 32, 1103, 1203, 1303, 1403],
  DOCKED_NOT_COMPLETE: [11, 33, 1104, 1204, 1304, 1404],
  FULL_FINISH_SWEEPING_ON_WAY_CHARGE: [12, 26, 38],
  SWEEPING: [7, 25, 36],
  BREAK_POINT: [39],
  QUICK_MAPPING_MAPPING: [45],
  QUICK_MAPPING_PAUSED: [46],
  QUICK_MAPPING_COMPLETED_RETURNING_TO_CHARGE: [47],
  QUICK_MAPPING_DOCKED_NOT_COMPLETE: [48],
});

// Reverse lookup helper: numeric mode code -> mode name (or null).
function parseVacuumMode(code) {
  if (code === null || code === undefined) return null;
  for (const [name, codes] of Object.entries(VacuumModeCodes)) {
    if (codes.includes(code)) return name;
  }
  return null;
}

// Vacuum fault codes — `code -> description` table.
const VacuumFaultCode = Object.freeze({
  500: "Lidar sensor blocked",
  501: "Vacuum not on ground",
  503: "Dustbin not installed",
  507: "Relocation failed",
  508: "Vacuum not on flat ground",
  510: "Vacuum stuck",
  511: "Failed to return to the charging station.",
  512: "Failed to return to the charging station.",
  513: "Mapping failed.",
  514: "Wheels stuck",
  521: "Water tank not installed",
  522: "Mop not installed",
  529: "Water tank and mop not installed",
  530: "2-in-1 dustbin with water tank and mop not installed",
  531: "2-in-1 dustbin with water tank not installed",
  567: "Vacuum stuck in no-go zone",
});

// Event-tracking arg vocabularies (com.wyze.sweeprobot.common.constant.VenusDotMessage).
// These are the literal strings the Wyze app sends as arg1/arg2/arg3 when
// reporting a control action to /plugin/venus/event_tracking.
const VenusDotArg1 = Object.freeze({
  Vacuum: "Vacuum",
});

const VenusDotArg2 = Object.freeze({
  Whole: "Whole",
  Spot: "Spot",
  SelectRooms: "SelectRooms",
  ManualRecharge: "ManualRecharge",
  FinishRecharge: "FinishRecharge",
  BreakCharging: "BreakCharging",
  BreakRecharge: "BreakRecharge",
});

const VenusDotArg3 = Object.freeze({
  Start: "Start",
  Resume: "Resume",
  Pause: "Pause",
  FalsePause: "FalsePause",
});

// VacuumControlType.code -> human-readable description that becomes `eventKey`
// in the event-tracking payload.
const VacuumControlTypeDescription = Object.freeze({
  0: "Clean",
  3: "Recharge",
  6: "Area Clean",
  7: "Quick Mapping",
});

// Default prop key lists used by getVacuumInfo. NOTE: "battary" is the
// literal Wyze API key (typo preserved by the server).
const VacuumIotPropKeys = Object.freeze([
  "iot_state",
  "battary",
  "mode",
  "chargeState",
  "cleanSize",
  "cleanTime",
  "fault_type",
  "fault_code",
  "current_mapid",
  "count",
  "cleanlevel",
  "notice_save_map",
  "memory_map_update_time",
  "filter",
  "side_brush",
  "main_brush",
]);

const VacuumDeviceInfoKeys = Object.freeze([
  "mac",
  "ipaddr",
  "device_type",
  "mcu_sys_version",
]);

module.exports = {
  propertyIds,
  propertyValues,
  DeviceModels,
  wyzeWallSwitch,
  wyzeColorProperty,
  homeKitColorProperty,
  wyze2HomekitUnits,
  wyze2HomekitStates,
  wyze2HomekitWorkingStates,
  VacuumControlType,
  VacuumControlValue,
  VacuumStatus,
  VacuumSuctionLevel,
  VacuumPreferenceType,
  VacuumModeCodes,
  parseVacuumMode,
  VacuumFaultCode,
  VacuumIotPropKeys,
  VacuumDeviceInfoKeys,
  VenusDotArg1,
  VenusDotArg2,
  VenusDotArg3,
  VacuumControlTypeDescription,
  LockStatusType,
  LockStatusDescription,
  parseLockStatus,
  LockEventType,
  LockEventTypeDescription,
  parseLockEventType,
  LockEventSourceCodes,
  LockEventSourceDescription,
  parseLockEventSource,
  LockVolumeLevel,
  LockLeftOpenTime,
  LockKeyType,
  LockKeyState,
  LockKeyOperation,
  LockKeyOperationStage,
  LockKeyPermissionType,
  LightControlMode,
  LightPowerLossRecoveryMode,
  ThermostatSystemMode,
  ThermostatFanMode,
  ThermostatScenarioType,
  ThermostatWorkingState,
  ThermostatTempUnit,
  ThermostatComfortBalanceMode,
  ThermostatComfortBalanceDescription,
  RoomSensorBatteryLevel,
  RoomSensorStatusType,
  RoomSensorStateType,
};