const axios = require("axios");
const crypto = require("../utils/crypto");
const constants = require("../constants");
const cameraStreamCapture = require("./cameraStreamCapture");

/**
 * Wyze Cameras — controls (power, siren, lights, motion, notifications,
 * recording), event list, push toggle, garage door, WebRTC streaming
 * (signaling URL + ICE), snapshot capture, and helpers.
 *
 * Routes through DeviceMgmt (services/devicemgmt.js) for newer cameras
 * (Floodlight Pro, Battery Cam Pro, OG cam) that don't respond to the
 * standard run_action endpoint.
 *
 * Thin wrappers (cameraPrivacy, cameraRestart, garageDoor, cameraFloodLight,
 * cameraSpotLight*, cameraSoundNotification*, cameraNotifications,
 * cameraMotionRecording*, cameraGetSignalingUrl, cameraGetIceServers) live in
 * cameras.helpers.js.
 */
module.exports = {
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
    this.log.debug(`Performing request: ${url}`);
    try {
      const response = await axios.post(url, body, { headers });
      await this._checkRateLimit(response.headers);

      const data = response.data;
              this.log.debug(`API response cameraGetStreamInfo: ${JSON.stringify(data)}`);

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
      // Cameras in WebRTC-only mode report iot-state=0 but still return a valid
      // signaling URL. Only block if there's genuinely no way to reach the camera.
      const hasSignalingUrl = typeof entry.params?.signaling_url === "string" && entry.params.signaling_url.length > 0;
      if (entry.property["iot-device::iot-state"] !== 1 && !hasSignalingUrl) {
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
