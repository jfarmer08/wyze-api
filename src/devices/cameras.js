const axios = require("axios");
const nodeCrypto = require("crypto");
const crypto = require("../crypto");
const constants = require("../constants");
const {
  propertyIds: PIDs,
  propertyValues: PVals,
  DeviceModels,
  DeviceMgmtToggleProps,
} = require("../types");
const cameraStreamCapture = require("../cameraStreamCapture");

/**
 * Wyze Cameras — controls (power, siren, lights, motion, notifications,
 * recording), event list, push toggle, garage door, WebRTC streaming
 * (signaling URL + ICE), snapshot capture, and helpers.
 *
 * Routes through DeviceMgmt (services/devicemgmt.js) for newer cameras
 * (Floodlight Pro, Battery Cam Pro, OG cam) that don't respond to the
 * standard run_action endpoint.
 */
module.exports = {
  // ---- Controls -----------------------------------------------------------

  async cameraPrivacy(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  },

  async cameraTurnOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "wakeup");
    }
    await this.runAction(deviceMac, deviceModel, "power_on");
  },

  async cameraTurnOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "power", "sleep");
    }
    await this.runAction(deviceMac, deviceModel, "power_off");
  },

  async cameraRestart(deviceMac, deviceModel) {
    return this.runAction(deviceMac, deviceModel, "restart");
  },

  /**
   * Recent camera events (motion / sound / face / etc.).
   */
  async getCameraEventList(options = {}) {
    const {
      count = 20,
      beginTime = Date.now() - 60 * 60 * 1000,
      endTime = Date.now(),
      deviceMac = "",
      eventValueList = ["1", "13", "10", "12"],
      orderBy = 2,
    } = options;
    const data = {
      begin_time: beginTime instanceof Date ? beginTime.getTime() : beginTime,
      end_time: endTime instanceof Date ? endTime.getTime() : endTime,
      event_type: "",
      count,
      order_by: orderBy,
      event_value_list: eventValueList,
      device_mac: deviceMac,
      device_mac_list: [],
      event_tag_list: [],
    };
    const result = await this.request("app/v2/device/get_event_list", data);
    return result.data;
  },

  /**
   * Account-level push notification toggle.
   */
  async setPushInfo(on) {
    const data = { push_switch: on ? "1" : "0" };
    const result = await this.request("app/user/set_push_info", data);
    return result.data;
  },

  /**
   * Open or close the garage door (single trigger action).
   */
  async garageDoor(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "garage_door_trigger");
  },

  // ---- Siren ---------------------------------------------------------------

  async cameraSiren(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  },

  async cameraSirenOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-on");
    }
    await this.runAction(deviceMac, deviceModel, "siren_on");
  },

  async cameraSirenOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "siren", "siren-off");
    }
    await this.runAction(deviceMac, deviceModel, "siren_off");
  },

  // ---- Floodlight / Spotlight (P1056) -------------------------------------

  async cameraFloodLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
  },

  async cameraFloodLightOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "floodlight", "1");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.ON);
  },

  async cameraFloodLightOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtRunAction(deviceMac, deviceModel, "floodlight", "0");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.OFF);
  },

  async cameraSpotLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
  },

  async cameraSpotLightOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.ON);
  },

  async cameraSpotLightOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, PVals.CAMERA_FLOOD_LIGHT.OFF);
  },

  // ---- Motion detection (three paths: DeviceMgmt / WCO / standard) --------

  async cameraMotionOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "1"
      );
    }
    if (
      DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      // Wyze Cam Outdoor (WVOD1 / HL_WCO2) uses a separate PID.
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "1");
    }
    // Standard cameras need both PIDs: state (P1047) and toggle (P1001).
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 1);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 1);
  },

  async cameraMotionOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.EVENT_RECORDING_TOGGLE, "0"
      );
    }
    if (
      DeviceModels.CAMERA_OUTDOOR.includes(deviceModel) ||
      DeviceModels.CAMERA_OUTDOOR_V2.includes(deviceModel)
    ) {
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "0");
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION_STATE, 0);
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_DETECTION, 0);
  },

  // ---- Sound notifications -------------------------------------------------

  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "1");
  },

  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "0");
  },

  // ---- Push notifications --------------------------------------------------

  async cameraNotifications(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, value);
  },

  async cameraNotificationsOn(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "1"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "1");
  },

  async cameraNotificationsOff(deviceMac, deviceModel) {
    if (DeviceModels.CAMERA_DEVICEMGMT.includes(deviceModel)) {
      return this._deviceMgmtSetToggle(
        deviceMac, deviceModel, DeviceMgmtToggleProps.NOTIFICATION_TOGGLE, "0"
      );
    }
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, "0");
  },

  // ---- Motion recording (cloud event recording) ----------------------------

  async cameraMotionRecording(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, value);
  },

  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "1");
  },

  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "0");
  },

  // ---- WebRTC streaming ---------------------------------------------------

  /**
   * Fetch WebRTC stream credentials. Does NOT return a playable URL;
   * caller must use a WebRTC client (werift, go2rtc, browser SDK).
   */
  async cameraGetStreamInfo(deviceMac, deviceModel, options = {}) {
    await this.maybeLogin();

    const parameters = { use_trickle: true };
    if (options.substream) parameters.sub_stream = true;

    const payload = {
      device_list: [
        { device_id: deviceMac, device_model: deviceModel, provider: "webrtc", parameters },
      ],
      nonce: String(Date.now()),
    };
    const body = JSON.stringify(payload);
    const signature = crypto.web_create_signature(body, this.access_token);

    const headers = {
      "Accept-Encoding": "gzip",
      appId: constants.webAppId,
      appInfo: constants.webAppInfo,
      access_token: this.access_token,
      Authorization: this.access_token,
      signature2: signature,
      requestid: String(Date.now() % 100000),
      "Content-Type": "application/json; charset=utf-8",
    };

    const url = `${constants.iot3BaseUrl}/app/v4/camera/get-streams`;
    if (this.apiLogEnabled) this.log.info(`Performing request: ${url}`);
    try {
      const response = await axios.post(url, body, { headers });
      await this._checkRateLimit(response.headers);

      const data = response.data;
      if (this.apiLogEnabled) {
        this.log.info(`API response cameraGetStreamInfo: ${JSON.stringify(data)}`);
      }

      const code = data?.code;
      const errorMessage = data?.msg || data?.description || "";

      if (typeof code !== "undefined" && Number(code) !== 1) {
        if (this._isAccessTokenError(code, errorMessage)) {
          await this._handleAccessTokenError(response, errorMessage, code, url, body);
          throw new Error(
            `Wyze access token error (${code}): ${errorMessage}. Token has been refreshed; retry the call.`
          );
        }
        if (this._isRateLimitError(code, errorMessage)) {
          throw new Error(`Wyze API rate limited (${code}): ${errorMessage}`);
        }
        if (String(code) === constants.deviceOfflineCode) {
          throw new Error(`Camera is offline: ${JSON.stringify(data)}`);
        }
        throw new Error(`Wyze API Error (${code}) - ${errorMessage}`);
      }

      if (!Array.isArray(data.data) || data.data.length !== 1) {
        throw new Error(`Unexpected response from cameraGetStreamInfo: ${JSON.stringify(data)}`);
      }

      const entry = data.data[0];
      if (!entry.property) {
        throw new Error(`Unexpected response from cameraGetStreamInfo: ${JSON.stringify(entry)}`);
      }
      if (entry.property["iot-device::iot-state"] !== 1) {
        throw new Error(`Camera is offline: ${JSON.stringify(entry)}`);
      }
      if (entry.property["iot-device::iot-power"] !== 1) {
        throw new Error(`Camera is off: ${JSON.stringify(entry)}`);
      }
      return entry.params;
    } catch (error) {
      this.log.error(`Request failed: ${error.message}`);
      if (error.response) {
        this.log.error(`Response cameraGetStreamInfo (${error.response.status} - ${error.response.statusText}): ${JSON.stringify(error.response.data, null, 2)}`);
      }
      throw error;
    }
  },

  async cameraGetSignalingUrl(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.signaling_url;
  },

  async cameraGetIceServers(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.ice_servers;
  },

  // ---- Pure helpers (sync, operate on a device object) --------------------

  cameraIsOnline(device) {
    if (device?.conn_state !== undefined) return device.conn_state === 1;
    if (device?.device_params?.status !== undefined) return device.device_params.status === 1;
    if (device?.is_online !== undefined) return Boolean(device.is_online);
    return false;
  },

  cameraGetThumbnail(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0]?.url ?? null;
    }
    return null;
  },

  cameraGetSnapshot(device) {
    const thumbnails = device?.device_params?.camera_thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length > 0) {
      return thumbnails[0] ?? null;
    }
    return null;
  },

  cameraToSummary(device) {
    return {
      mac: device?.mac,
      productModel: device?.product_model,
      nickname: device?.nickname,
      online: this.cameraIsOnline(device),
      thumbnail: this.cameraGetThumbnail(device),
    };
  },

  // ---- Lookup --------------------------------------------------------------

  async getCameras() {
    return this.getDevicesByType("Camera");
  },

  async getOnlineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => this.cameraIsOnline(camera));
  },

  async getOfflineCameras() {
    const cameras = await this.getCameras();
    return cameras.filter((camera) => !this.cameraIsOnline(camera));
  },

  async getCamera(mac) {
    const cameras = await this.getCameras();
    return cameras.find((camera) => camera.mac === mac);
  },

  async getCameraByName(nickname) {
    const cameras = await this.getCameras();
    return cameras.find(
      (camera) => camera?.nickname?.toLowerCase() === nickname?.toLowerCase()
    );
  },

  async getCameraSnapshot(mac) {
    const camera = await this.getCamera(mac);
    return camera ? this.cameraGetSnapshot(camera) : null;
  },

  async getCameraSnapshotUrl(mac) {
    const snapshot = await this.getCameraSnapshot(mac);
    return snapshot?.url ?? null;
  },

  async getCameraSummaries() {
    const cameras = await this.getCameras();
    return cameras.map((device) => this.cameraToSummary(device));
  },

  // ---- Snapshot capture (headless WebRTC) ---------------------------------

  /**
   * Capture a single JPEG via headless WebRTC. Requires `ffmpeg-static`
   * (bundled). Cached per-mac for cacheTtlMs (default 10s).
   */
  async cameraCaptureSnapshot(deviceMac, deviceModel, options = {}) {
    const { timeoutMs = 20_000, noCache = false, cacheTtlMs = 10_000 } = options;

    if (!this._snapshotCaptureCache) this._snapshotCaptureCache = new Map();
    if (!noCache) {
      const entry = this._snapshotCaptureCache.get(deviceMac);
      if (entry && entry.expiresAt > Date.now()) return entry.buffer;
    }

    const conn = await this.getCameraWebRTCConnectionInfo(deviceMac, deviceModel, {
      noCache: true,
      includeClientId: false,
    });

    const buffer = await cameraStreamCapture.captureStreamFrame({
      signalingUrl: conn.signalingUrl,
      iceServers: conn.iceServers,
      logger: this.apiLogEnabled ? this.log : null,
      timeoutMs,
    });

    if (!noCache) {
      this._snapshotCaptureCache.set(deviceMac, {
        buffer,
        expiresAt: Date.now() + cacheTtlMs,
      });
    }
    return buffer;
  },

  /**
   * Cloud thumbnail first, fall back to live capture.
   */
  async getCameraSnapshotImage(mac, options = {}) {
    if (!options.skipCloud) {
      const cloud = await this.getCameraSnapshot(mac);
      if (cloud?.url) {
        try {
          const resp = await axios.get(cloud.url, { responseType: "arraybuffer" });
          return { buffer: Buffer.from(resp.data), source: "cloud" };
        } catch (err) {
          this.log.warning(`Cloud snapshot fetch failed, falling back to capture: ${err.message}`);
        }
      }
    }

    const camera = await this.getCamera(mac);
    if (!camera) throw new Error(`Camera not found: ${mac}`);
    const buffer = await this.cameraCaptureSnapshot(camera.mac, camera.product_model, options);
    return { buffer, source: "capture" };
  },

  // ---- Camera-specific device-info accessors -------------------------------

  cameraGetSignalStrength(device) {
    return device?.device_params?.signal_strength ?? null;
  },

  cameraGetIp(device) {
    return device?.device_params?.ip ?? null;
  },

  cameraGetFirmware(device) {
    return device?.firmware_ver ?? null;
  },

  cameraGetTimezone(device) {
    return device?.timezone_name ?? null;
  },

  cameraGetLastSeen(device) {
    const ts = device?.device_params?.last_login_time;
    return typeof ts === "number" ? new Date(ts) : null;
  },

  // ---- Stream connection helpers ------------------------------------------

  createCameraStreamClientId(deviceOrMac, prefix = "viewer") {
    const mac = typeof deviceOrMac === "string" ? deviceOrMac : deviceOrMac?.mac;
    const safePrefix = String(prefix || "viewer").replace(/[^a-zA-Z0-9_-]/g, "-");
    const macSlug =
      (mac || "camera").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "camera";
    const random = nodeCrypto.randomBytes(4).toString("hex");
    return `${safePrefix}-${macSlug}-${Date.now()}-${random}`;
  },

  /**
   * Decode double-encoded Kinesis Video signaling URLs (idempotent).
   */
  normalizeCameraSignalingUrl(signalingUrl) {
    if (!signalingUrl || typeof signalingUrl !== "string") return signalingUrl;
    if (signalingUrl.includes("%25")) {
      try {
        return decodeURIComponent(signalingUrl);
      } catch (_) {
        return signalingUrl;
      }
    }
    return signalingUrl;
  },

  /**
   * Convert Wyze ICE entries to the {urls,...} shape RTCPeerConnection wants.
   */
  sanitizeCameraIceServers(iceServers = []) {
    return iceServers
      .map((server) => {
        if (!server || !server.url) return null;
        const out = { urls: server.url };
        if (server.username) out.username = server.username;
        if (server.credential) out.credential = server.credential;
        return out;
      })
      .filter(Boolean);
  },

  /**
   * Parse online/power state from a raw cameraGetStreamInfo response.
   */
  parseCameraStatus(streamInfoResponse) {
    try {
      const item = streamInfoResponse?.data?.[0];
      if (!item?.property) return null;
      return {
        online: item.property["iot-device::iot-state"] === 1,
        powered: item.property["iot-device::iot-power"] === 1,
      };
    } catch (_) {
      return null;
    }
  },

  _streamCacheKey(deviceMac, deviceModel, substream) {
    return `${deviceMac}:${deviceModel}:${substream ? "sub" : "main"}`;
  },

  /**
   * Bundle for a WebRTC client: signalingUrl + iceServers + authToken +
   * clientId. Cached per (mac, model, substream) for cacheTtlMs (60s default).
   */
  async getCameraWebRTCConnectionInfo(deviceMac, deviceModel, options = {}) {
    const {
      substream = false,
      includeClientId = true,
      clientId,
      clientIdPrefix = "viewer",
      noCache = false,
      cacheTtlMs = 60_000,
    } = options;

    if (!this._streamInfoCache) this._streamInfoCache = new Map();
    const cacheKey = this._streamCacheKey(deviceMac, deviceModel, substream);
    let bundle;
    let cached = false;

    if (!noCache) {
      const entry = this._streamInfoCache.get(cacheKey);
      if (entry && entry.expiresAt > Date.now()) {
        bundle = entry.bundle;
        cached = true;
      }
    }

    if (!bundle) {
      const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, { substream });
      bundle = {
        signalingUrl: this.normalizeCameraSignalingUrl(info.signaling_url),
        iceServers: this.sanitizeCameraIceServers(info.ice_servers),
        authToken: info.auth_token ?? null,
      };
      if (!noCache) {
        this._streamInfoCache.set(cacheKey, {
          bundle,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
    }

    const result = { ...bundle, mac: deviceMac, model: deviceModel, substream, cached };
    if (includeClientId) {
      result.clientId = clientId || this.createCameraStreamClientId(deviceMac, clientIdPrefix);
    }
    return result;
  },

  /**
   * getCameraWebRTCConnectionInfo with exponential-backoff retry.
   */
  async getCameraWebRTCConnectionInfoWithReconnect(
    deviceMac,
    deviceModel,
    options = {},
    retryOptions = {}
  ) {
    return this.cameraStreamWithReconnect(
      () => this.getCameraWebRTCConnectionInfo(deviceMac, deviceModel, options),
      retryOptions
    );
  },

  /**
   * Generic exponential-backoff wrapper for any stream call.
   */
  async cameraStreamWithReconnect(fn, { maxAttempts = 3, baseDelayMs = 2000, onRetry } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (attempt >= maxAttempts) throw err;
        if (onRetry) onRetry(attempt, err);
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  },

  /**
   * Clear the in-memory stream-info cache.
   */
  clearCameraStreamCache(deviceMac) {
    if (!this._streamInfoCache) return;
    if (!deviceMac) {
      this._streamInfoCache.clear();
      return;
    }
    for (const key of this._streamInfoCache.keys()) {
      if (key.startsWith(`${deviceMac}:`)) this._streamInfoCache.delete(key);
    }
  },
};
