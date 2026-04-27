const nodeCrypto = require("crypto");
const {
  propertyIds: PIDs,
  propertyValues: PVals,
  DeviceModels,
  DeviceMgmtToggleProps,
} = require("../types");

/**
 * Camera helpers — pure device-object accessors, convenience lookup wrappers,
 * stream utility functions, and thin-wrapper controls. None of the functions
 * here contain branching logic or direct API calls (those live in cameras.js).
 */
module.exports = {
  // ---- Model-branching controls --------------------------------------------

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
      return this.setProperty(deviceMac, deviceModel, PIDs.WCO_MOTION_DETECTION, "1");
    }
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

  // ---- Thin-wrapper controls -----------------------------------------------

  async cameraPrivacy(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  },

  async cameraRestart(deviceMac, deviceModel) {
    return this.runAction(deviceMac, deviceModel, "restart");
  },

  /**
   * Open or close the garage door (single trigger action).
   */
  async garageDoor(deviceMac, deviceModel) {
    await this.runAction(deviceMac, deviceModel, "garage_door_trigger");
  },

  async cameraSiren(deviceMac, deviceModel, value) {
    await this.runAction(deviceMac, deviceModel, value);
  },

  async cameraFloodLight(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.CAMERA_FLOOD_LIGHT, value);
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

  async cameraSoundNotificationOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "1");
  },

  async cameraSoundNotificationOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.SOUND_NOTIFICATION, "0");
  },

  async cameraNotifications(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.NOTIFICATION, value);
  },

  async cameraMotionRecording(deviceMac, deviceModel, value) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, value);
  },

  async cameraMotionRecordingOn(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "1");
  },

  async cameraMotionRecordingOff(deviceMac, deviceModel) {
    await this.setProperty(deviceMac, deviceModel, PIDs.MOTION_RECORDING, "0");
  },

  async cameraGetSignalingUrl(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.signaling_url;
  },

  async cameraGetIceServers(deviceMac, deviceModel, options = {}) {
    const info = await this.cameraGetStreamInfo(deviceMac, deviceModel, options);
    return info.ice_servers;
  },

  // ---- Device-info pure accessors ------------------------------------------

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

  // ---- Pure device-object accessors -----------------------------------------

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

  // ---- Convenience lookup wrappers ------------------------------------------

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

  // ---- Stream utility functions ---------------------------------------------

  createCameraStreamClientId(deviceOrMac, prefix = "viewer") {
    const mac = typeof deviceOrMac === "string" ? deviceOrMac : deviceOrMac?.mac;
    const safePrefix = String(prefix || "viewer").replace(/[^a-zA-Z0-9_-]/g, "-");
    const macSlug =
      (mac || "camera").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase() || "camera";
    const random = nodeCrypto.randomBytes(4).toString("hex");
    return `${safePrefix}-${macSlug}-${Date.now()}-${random}`;
  },

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
};
