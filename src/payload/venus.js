const { venusPluginVersion, vacuumFirmwareVersion, phoneId, appVersion, phoneOsVersion } = require("../constants");

// Venus Payloads
function createGetDeviceInfoPayload(device_mac, keys) {
  return {
    keys: keys,
    device_id: device_mac,
    nonce: Date.now().toString(),
  };
}

function createSetCurrentMapPayload(device_mac, mapId) {
  return {
    did: device_mac,
    map_id: mapId
  }
}

function createSweepRecordsPayload(device_mac, limit) {
  return {
    did: device_mac,
    purpose: 'history_map',
    count: limit,
    last_time: Date.now().toString()
  }
}

function createGetPayload(device_mac) {
  return {
    did: device_mac
  }
}

function setIotActionSetPayload(device_mac,device_model, cmd){
  return {
    did: device_mac,
    model: device_model,
    cmd: cmd,
    is_sub_device: 0,
    nonce: Date.now().toString(),
  }
}

function createEventPayload(device_mac, type, value) {
  return {
    'uuid': '88DBF3344D20B5597DB7C8F0AFBB4030',
    'deviceId': device_mac,
    'createTime': Date.now().toString(),
    'mcuSysVersion': vacuumFirmwareVersion,
    'appVersion': appVersion,
    'pluginVersion': venusPluginVersion,
    'phoneId': phoneId,
    'phoneOsVersion': phoneOsVersion,
    'eventKey': type.description,
    'eventType': value.code,
  }
}

function createControlPayload(type,value) {
  return {
    type: type,
    value: value,
    vacuumMopMode: 0,
  }
}
  //if rooms is not None:
    //  if not isinstance(rooms, (list, Tuple)):
      //    rooms = [rooms]
      //kwargs.update({"rooms_id": rooms})

module.exports = {
  createSetCurrentMapPayload,
  createSweepRecordsPayload,
  createGetPayload,
  createGetDeviceInfoPayload,
  setIotActionSetPayload,
  createEventPayload,
  createControlPayload,
};
