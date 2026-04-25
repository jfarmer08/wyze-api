const constants = require("./constants");
const crypto = require("./crypto");

function fordCreatePayload(access_token, payload, url_path, request_method) {
  return {
    ...payload,
    accessToken: access_token,
    key: constants.fordAppKey,
    timestamp: Date.now().toString(),
    sign: crypto.fordCreateSignature(url_path, request_method, payload),
  };
}

function oliveCreateGetPayload(device_mac, keys) {
  return {
    keys,
    did: device_mac,
    nonce: Date.now().toString(),
  };
}

function oliveCreatePostPayload(device_mac, device_model, prop_key, value) {
  return {
    did: device_mac,
    model: device_model,
    props: {
      [prop_key]: value,
    },
    is_sub_device: 0,
    nonce: Date.now().toString(),
  };
}

function oliveCreateHmsPayload() {
  return {
    group_id: "hms",
    nonce: Date.now().toString(),
  };
}

function oliveCreateUserInfoPayload() {
  return {
    nonce: Date.now().toString(),
  };
}

function oliveCreateHmsGetPayload(hms_id) {
  return {
    hms_id,
    nonce: Date.now().toString(),
  };
}

function oliveCreateHmsPatchPayload(hms_id) {
  return {
    hms_id,
  };
}

function oliveCreateGetPayloadIrrigation(device_mac) {
  return {
    device_id: device_mac,
    nonce: Date.now().toString(),
  };
}

function oliveCreatePostPayloadIrrigationStop(device_mac, action) {
  return {
    device_id: device_mac,
    nonce: Date.now().toString(),
    action: action,
  };
}

function oliveCreatePostPayloadIrrigationQuickRun(
  device_mac,
  zone_number,
  duration
) {
  return {
    device_id: device_mac,
    nonce: Date.now().toString(),
    zone_runs: [
      {
        zone_number: zone_number,
        duration: duration,
      },
    ],
  };
}

function oliveCreateGetPayloadIrrigationScheduleRuns(device_mac) {
  return {
    device_id: device_mac,
    nonce: Date.now().toString(),
  };
}

function iot3CreateGetPayload(deviceMac, model, props) {
  const ts = Date.now();
  return {
    nonce: String(ts),
    payload: {
      cmd: "get_property",
      props,
      tid: Math.floor(Math.random() * 89000) + 10000,
      ts,
      ver: 1,
    },
    targetInfo: {
      id: deviceMac,
      model,
    },
  };
}

function iot3CreateRunActionPayload(deviceMac, model, action, username) {
  const ts = Date.now();
  return {
    nonce: String(ts),
    payload: {
      action,
      cmd: "run_action",
      params: {
        action_id: Math.floor(Math.random() * 90000) + 10000,
        type: 1,
        username,
      },
      tid: Math.floor(Math.random() * 89000) + 10000,
      ts,
      ver: 1,
    },
    targetInfo: {
      id: deviceMac,
      model,
    },
  };
}

module.exports = {
  fordCreatePayload,
  oliveCreateGetPayload,
  oliveCreatePostPayload,
  oliveCreateHmsPayload,
  oliveCreateUserInfoPayload,
  oliveCreateHmsGetPayload,
  oliveCreateHmsPatchPayload,
  oliveCreateGetPayloadIrrigation,
  oliveCreatePostPayloadIrrigationStop,
  oliveCreatePostPayloadIrrigationQuickRun,
  oliveCreateGetPayloadIrrigationScheduleRuns,
  iot3CreateGetPayload,
  iot3CreateRunActionPayload,
};
