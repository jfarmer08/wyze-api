const propertyIds = {
  NOTIFICATION: "P1",
  ON: "P3",
  AVAILABLE: "P5",
  BRIGHTNESS: "P1501",
  COLOR_TEMP: "P1502",
  CAMERA_SIREN: "P1049",
  CAMERA_FLOOD_LIGHT: "P1056",
};

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

// Wyze Robot Vacuum (Venus service) — codes lifted from wyze_sdk's
// VacuumDeviceControlRequestType / RequestValue / VacuumStatus / VacuumSuctionLevel.

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
// variants), so this is a many-to-one lookup. Pulled from VacuumMode in
// wyze_sdk.models.devices.vacuums (sourced from com.wyze.sweeprobot f0.c).
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

// Vacuum fault codes — see VacuumFaultCode in wyze_sdk.
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
// in the event-tracking payload (mirrors wyze-sdk's `type.description`).
const VacuumControlTypeDescription = Object.freeze({
  0: "Clean",
  3: "Recharge",
  6: "Area Clean",
  7: "Quick Mapping",
});

// Default prop key lists used by getVacuumInfo, mirroring Vacuum.props() and
// Vacuum.device_info_props() in wyze-sdk. NOTE: "battary" is the literal
// Wyze API key (typo preserved by the server).
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
};