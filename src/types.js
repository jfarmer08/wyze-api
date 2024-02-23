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

const GET_CMDS = {
  "state": null,
  "power": null,
  "update_snapshot": null,
  "take_photo": "K10058TakePhoto",
  "irled": "K10044GetIRLEDStatus",
  "night_vision": "K10040GetNightVisionStatus",
  "status_light": "K10030GetNetworkLightStatus",
  "osd_timestamp": "K10070GetOSDStatus",
  "osd_logo": "K10074GetOSDLogoStatus",
  "camera_time": "K10090GetCameraTime",
  "night_switch": "K10624GetAutoSwitchNightType",
  "alarm": "K10632GetAlarmFlashing",
  "start_boa": "K10148StartBoa",
  "cruise_points": "K11010GetCruisePoints",
  "pan_cruise": "K11014GetCruise",
  "ptz_position": "K11006GetCurCruisePoint",
  "motion_tracking": "K11020GetMotionTracking",
  "motion_tagging": "K10290GetMotionTagging",
  "camera_info": "K10020CheckCameraInfo",
  "battery_usage": "K10448GetBatteryUsage",
  "rtsp": "K10604GetRtspParam",
  "accessories": "K10720GetAccessoriesInfo",
  "floodlight": "K10788GetIntegratedFloodlightInfo",
  "whitelight": "K10820GetWhiteLightInfo",
  "param_info": "K10020CheckCameraParams",  
  "_bitrate": "K10050GetVideoParam",  
};

const GET_PAYLOAD = new Set(["param_info"]);

const SET_CMDS = {
  "state": null,
  "power": null,
  "time_zone": null,
  "cruise_point": null,
  "fps": null,
  "bitrate": null,
  "irled": "K10046SetIRLEDStatus",
  "night_vision": "K10042SetNightVisionStatus",
  "status_light": "K10032SetNetworkLightStatus",
  "osd_timestamp": "K10072SetOSDStatus",
  "osd_logo": "K10076SetOSDLogoStatus",
  "camera_time": "K10092SetCameraTime",
  "night_switch": "K10626SetAutoSwitchNightType",
  "alarm": "K10630SetAlarmFlashing",
  "rotary_action": "K11002SetRotaryByAction",
  "rotary_degree": "K11000SetRotaryByDegree",
  "reset_rotation": "K11004ResetRotatePosition",
  "cruise_points": "K11012SetCruisePoints",
  "pan_cruise": "K11016SetCruise",
  "ptz_position": "K11018SetPTZPosition",
  "motion_tracking": "K11022SetMotionTracking",
  "motion_tagging": "K10292SetMotionTagging",
  "hor_flip": "K10052HorizontalFlip",
  "ver_flip": "K10052VerticalFlip",
  "rtsp": "K10600SetRtspSwitch",
  "quick_response": "K11635ResponseQuickMessage",
  "spotlight": "K10646SetSpotlightStatus",
  "floodlight": "K12060SetFloodLightSwitch",
  "format_sd" : "K10242FormatSDCard",
};

const CMD_VALUES = {
  "on": 1,
  "off": 2,
  "auto": 3,
  "true": 1,
  "false": 2,
  "left": [-90, 0],
  "right": [90, 0],
  "up": [0, 90],
  "down": [0, -90],
};

const PARAMS = {
  "status_light": "1",
  "night_vision": "2",
  "bitrate": "3",
  "res": "4",
  "fps": "5",
  "hor_flip": "6",
  "ver_flip": "7",
  "motion_tagging": "21",
  "time_zone": "22",
  "motion_tracking": "27",
  "irled": "50",
};