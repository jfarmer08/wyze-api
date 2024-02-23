import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import fetch from 'node-fetch';

const IOS_VERSION = process.env.IOS_VERSION;
const APP_VERSION = process.env.APP_VERSION;
const SCALE_USER_AGENT = `Wyze/${APP_VERSION} (iPhone; iOS ${IOS_VERSION}; Scale/3.00)`;
const AUTH_API = 'https://auth-prod.api.wyze.com';
const WYZE_API = 'https://api.wyzecam.com/app';
const SC_SV = {
  default: {
    sc: '9f275790cab94a72bd206c8876429f3c',
    sv: 'e1fe392906d54888a9b99b88de4162d7',
  },
  run_action: {
    sc: '01dd431d098546f9baf5233724fa2ee2',
    sv: '2c0edc06d4c5465b8c55af207144f0d9',
  },
  get_device_Info: {
    sc: '01dd431d098546f9baf5233724fa2ee2',
    sv: '0bc2c3bedf6c4be688754c9ad42bbf2e',
  },
  get_event_list: {
    sc: '9f275790cab94a72bd206c8876429f3c',
    sv: '782ced6909a44d92a1f70d582bbe88be',
  },
  set_device_Info: {
    sc: '01dd431d098546f9baf5233724fa2ee2',
    sv: 'e8e1db44128f4e31a2047a8f5f80b2bd',
  },
};

class AccessTokenError extends Error {}

class RateLimitError extends Error {
  constructor(resp) {
    const reset = resp.headers.get('X-RateLimit-Reset-By');
    const remaining = parseInt(resp.headers.get('X-RateLimit-Remaining') || '0');
    const resetBy = this.getResetTime(reset);
    super(`${remaining} requests remaining until ${reset}`);
    this.remaining = remaining;
    this.resetBy = resetBy;
  }

  getResetTime(resetBy) {
    const tsFormat = 'EEE MMM dd HH:mm:ss zzz yyyy';
    try {
      return Math.floor(DateTime.fromFormat(resetBy, tsFormat).toSeconds());
    } catch (error) {
      return 0;
    }
  }
}

class WyzeAPIError extends Error {
  constructor(code, msg) {
    super(`${code}=${msg}`);
    this.code = code;
    this.msg = msg;
  }
}

function login(email, password, phone_id = null, mfa = null, api_key = null, key_id = null) {
  phone_id = phone_id || uuidv4();
  const headers = headers(phone_id, key_id, api_key);
  headers['content-type'] = 'application/json';
  const payload = sortDict({ email: email.trim(), password: hashPassword(password), ...(mfa || {}) });
  let apiVersion = 'v2';
  if (key_id && api_key) {
    apiVersion = 'api';
  } else if (process.env.v3) {
    apiVersion = 'v3';
    headers['appid'] = 'umgm_78ae6013d158c4a5';
    headers['signature2'] = signMsg('v3', payload);
  }
  return fetch(`${AUTH_API}/${apiVersion}/user/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => WyzeCredential.modelValidate({ ...data, phone_id }));
}

function sendSmsCode(auth_info, phone = 'Primary') {
  return fetch(`${AUTH_API}/user/login/sendSmsCode?mfaPhoneType=${phone}&sessionId=${auth_info.sms_session_id}&userId=${auth_info.user_id}`, {
    method: 'POST',
    headers: headers(auth_info.phone_id),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data.session_id);
}

function sendEmailCode(auth_info) {
  return fetch(`${AUTH_API}/v2/user/login/sendEmailCode?userId=${auth_info.user_id}&sessionId=${auth_info.email_session_id}`, {
    method: 'POST',
    headers: headers(auth_info.phone_id),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data.session_id);
}

function refreshToken(auth_info) {
  const payload = payload(auth_info.access_token, auth_info.phone_id);
  payload.refresh_token = auth_info.refresh_token;
  return fetch(`${WYZE_API}/user/refresh_token`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => WyzeCredential.modelValidate({ ...data.data, user_id: auth_info.user_id, phone_id: auth_info.phone_id }));
}

function getUserInfo(auth_info) {
  return fetch(`${WYZE_API}/user/get_user_info`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload(auth_info.access_token, auth_info.phone_id)),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => WyzeAccount.modelValidate({ ...data.data, phone_id: auth_info.phone_id }));
}

function getHomepageObjectList(auth_info) {
  return fetch(`${WYZE_API}/v2/home_page/get_object_list`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload(auth_info.access_token, auth_info.phone_id)),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data);
}

function getCameraList(auth_info) {
  return getHomepageObjectList(auth_info).then((data) => {
    const result = [];
    for (const device of data.device_list) {
      if (device.product_type !== 'Camera') {
        continue;
      }
      const deviceParams = device.device_params || {};
      const p2p_id = deviceParams.p2p_id;
      const p2p_type = deviceParams.p2p_type;
      const ip = deviceParams.ip;
      const enr = device.enr;
      const mac = device.mac;
      const product_model = device.product_model;
      const nickname = device.nickname;
      const timezone_name = device.timezone_name;
      const firmware_ver = device.firmware_ver;
      const dtls = deviceParams.dtls;
      const parent_dtls = deviceParams.main_device_dtls;
      const parent_enr = device.parent_device_enr;
      const parent_mac = device.parent_device_mac;
      const thumbnail = deviceParams.camera_thumbnails?.thumbnails_url;
      if (!mac || !product_model) {
        continue;
      }
      result.push(
        new WyzeCamera({
          p2p_id,
          p2p_type,
          ip,
          enr,
          mac,
          product_model,
          nickname,
          timezone_name,
          firmware_ver,
          dtls,
          parent_dtls,
          parent_enr,
          parent_mac,
          thumbnail,
        })
      );
    }
    return result;
  });
}

function runAction(auth_info, camera, action) {
  const payload = {
    ...payload(auth_info.access_token, auth_info.phone_id, 'run_action'),
    action_params: {},
    action_key: action,
    instance_id: camera.mac,
    provider_key: camera.product_model,
  };
  return fetch(`${WYZE_API}/v2/auto/run_action`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data);
}

function postV2Device(auth_info, endpoint, params) {
  params = { ...params, ...payload(auth_info.access_token, auth_info.phone_id, endpoint) };
  return fetch(`${WYZE_API}/v2/device/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data);
}

function postDevice(auth_info, endpoint, params) {
  params = { ...params, ...payload(auth_info.access_token, auth_info.phone_id, endpoint) };
  return fetch(`${WYZE_API}/device/${endpoint}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((data) => data);
}

function getCamWebrtc(auth_info, mac_id) {
  if (!auth_info.access_token) {
    throw new AccessTokenError();
  }
  const uiHeaders = headers();
  uiHeaders['content-type'] = 'application/json';
  uiHeaders['authorization'] = auth_info.access_token;
  return fetch(`https://webrtc.api.wyze.com/signaling/device/${mac_id}?use_trickle=true`, {
    headers: uiHeaders,
  })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(resp.statusText);
      }
      return resp.json();
    })
    .then((respJson) => {
      for (const s of respJson.results.servers) {
        if ('url' in s) {
          s.urls = s.url;
          delete s.url;
        }
      }
      return {
        ClientId: auth_info.phone_id,
        signalingUrl: decodeURIComponent(respJson.results.signalingUrl),
        servers: respJson.results.servers,
      };
    });
}

function validateResp(resp) {
  if (!resp.ok) {
    throw new Error(resp.statusText);
  }
  if (parseInt(resp.headers.get('X-RateLimit-Remaining') || '100') <= 10) {
    throw new RateLimitError(resp);
  }
  const respJson = resp.json();
  if (String(respJson.code || 0) === '2001') {
    throw new AccessTokenError();
  }
  if (String(respJson.code || 0) !== '1') {
    throw new WyzeAPIError(respJson.code, respJson.msg);
  }
  return respJson;
}

function payload(access_token, phone_id = '', endpoint = 'default') {
  return {
    sc: SC_SV[endpoint].sc,
    sv: SC_SV[endpoint].sv,
    app_ver: `com.hualai.WyzeCam___${APP_VERSION}`,
    app_version: APP_VERSION,
    app_name: 'com.hualai.WyzeCam',
    phone_system_type: 1,
    ts: Math.floor(Date.now()),
    access_token,
    phone_id,
  };
}

function headers(phone_id = null, key_id = null, api_key = null) {
  if (!phone_id) {
    return { 'user-agent': SCALE_USER_AGENT };
  }
  if (key_id && api_key) {
    return {
      apikey: api_key,
      keyid: key_id,
      'user-agent': `docker-wyze-bridge/${process.env.VERSION}`,
    };
  }
  return {
    'x-api-key': 'WMXHYf79Nr5gIlt3r0r7p9Tcw5bvs6BB4U8O8nGJ',
    'phone-id': phone_id,
    'user-agent': `wyze_ios_${APP_VERSION}`,
  };
}

function hashPassword(password) {
  let encoded = password.trim();
  for (let i = 0; i < 3; i++) {
    encoded = createHmac('md5', encoded).digest('hex');
  }
  return encoded;
}

function sortDict(payload) {
  return JSON.stringify(Object.fromEntries(Object.entries(payload).sort()), (key, value) => {
    if (typeof value === 'number') {
      return value.toString();
    }
    return value;
  });
}

function signMsg(app_id, msg, token = '') {
  const key = createHmac('md5', token + process.env[app_id]).digest();
  const msgStr = typeof msg === 'object' ? sortDict(msg) : msg;
  return createHmac('md5', key).update(msgStr).digest('hex');
}


