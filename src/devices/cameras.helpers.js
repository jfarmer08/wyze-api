const nodeCrypto = require("crypto");

/**
 * Camera helpers — pure device-object accessors, convenience lookup wrappers,
 * and stream utility functions. None of these hit the Wyze control plane
 * directly (they delegate to core camera methods or work on plain objects).
 */
module.exports = {
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
