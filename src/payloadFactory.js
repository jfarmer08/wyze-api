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

module.exports = {
  fordCreatePayload,
  oliveCreateGetPayload,
  oliveCreatePostPayload,
  oliveCreateHmsPayload,
  oliveCreateUserInfoPayload,
  oliveCreateHmsGetPayload,
  oliveCreateHmsPatchPayload,
};
