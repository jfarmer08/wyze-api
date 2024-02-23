class WyzeCredential {
    constructor({
      access_token = null,
      refresh_token = null,
      user_id = null,
      mfa_options = null,
      mfa_details = null,
      sms_session_id = null,
      email_session_id = null,
      phone_id = null
    } = {}) {
      this.access_token = access_token;
      this.refresh_token = refresh_token;
      this.user_id = user_id;
      this.mfa_options = mfa_options;
      this.mfa_details = mfa_details;
      this.sms_session_id = sms_session_id;
      this.email_session_id = email_session_id;
      this.phone_id = phone_id || this.generateUUID();
    }
  
    generateUUID() {
      return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
    }
  }
  
  class WyzeAccount {
    constructor({
      phone_id,
      logo,
      nickname,
      email,
      user_code,
      user_center_id,
      open_user_id
    }) {
      this.phone_id = phone_id;
      this.logo = logo;
      this.nickname = nickname;
      this.email = email;
      this.user_code = user_code;
      this.user_center_id = user_center_id;
      this.open_user_id = open_user_id;
    }
  }
  
  class WyzeCamera {
    constructor({
      p2p_id = null,
      p2p_type = null,
      ip = null,
      enr = null,
      mac,
      product_model,
      camera_info = null,
      nickname = null,
      timezone_name = null,
      firmware_ver = null,
      dtls = null,
      parent_dtls = null,
      parent_enr = null,
      parent_mac = null,
      thumbnail = null
    }) {
      this.p2p_id = p2p_id;
      this.p2p_type = p2p_type;
      this.ip = ip;
      this.enr = enr;
      this.mac = mac;
      this.product_model = product_model;
      this.camera_info = camera_info;
      this.nickname = nickname;
      this.timezone_name = timezone_name;
      this.firmware_ver = firmware_ver;
      this.dtls = dtls;
      this.parent_dtls = parent_dtls;
      this.parent_enr = parent_enr;
      this.parent_mac = parent_mac;
      this.thumbnail = thumbnail;
    }
  
    setCameraInfo(info) {
      this.camera_info = info;
    }
  
    get nameUri() {
      let uriSep = "-";
      const uriSeparator = process.env.URI_SEPARATOR;
      if (["-", "_", " "].includes(uriSeparator)) {
        uriSep = uriSeparator;
      }
      let uri = this.cleanName(this.nickname || this.mac, uriSep).toLowerCase();
      if (process.env.URI_MAC && process.env.URI_MAC.toLowerCase() === "true" && (this.mac || this.parent_mac)) {
        uri += uriSep + (this.mac || this.parent_mac || "").slice(-4);
      }
      return uri;
    }
  
    get modelName() {
      return MODEL_NAMES[this.product_model] || this.product_model;
    }
  
    get webrtcSupport() {
      return !NO_WEBRTC.has(this.product_model);
    }
  
    get is2k() {
      return PRO_CAMS.has(this.product_model) || this.modelName.endsWith("Pro");
    }
  
    get defaultSampleRate() {
      return AUDIO_16k.has(this.product_model) ? 16000 : 8000;
    }
  
    get isGwell() {
      return this.product_model.startsWith("GW_");
    }
  
    get isBattery() {
      return BATTERY_CAMS.has(this.product_model);
    }
  
    get isVertical() {
      return VERTICAL_CAMS.has(this.product_model);
    }
  
    get isPanCam() {
      return PAN_CAMS.has(this.product_model);
    }
  
    get canSubstream() {
      if (this.rtspFw) {
        return false;
      }
      const minVer = SUBSTREAM_FW[this.product_model];
      return this.isMinVersion(this.firmware_ver, minVer);
    }
  
    get rtspFw() {
      return this.firmware_ver && RTSP_FW.some(prefix => this.firmware_ver.startsWith(prefix));
    }
  
    cleanName(name, uriSep = "_") {
      return name.trim().replace(/[^-\w+]/g, "").replace(/ /g, uriSep)
        .replace(/[^\x00-\x7F]/g, "").toUpperCase();
    }
  
    isMinVersion(version, minVersion) {
      if (!version || !minVersion) {
        return false;
      }
      const versionParts = version.split(".").map(Number);
      const minVersionParts = minVersion.split(".").map(Number);
      return versionParts >= minVersionParts || (versionParts === minVersionParts && version >= minVersion);
    }
  }
  
  const MODEL_NAMES = {
    // ... (same as Python dictionary)
  };
  
  const NO_WEBRTC = new Set([
    // ... (same as Python set)
  ]);
  
  const PRO_CAMS = new Set([
    // ... (same as Python set)
  ]);
  
  const PAN_CAMS = new Set([
    // ... (same as Python set)
  ]);
  
  const BATTERY_CAMS = new Set([
    // ... (same as Python set)
  ]);
  
  const AUDIO_16k = new Set([
    // ... (same as Python set)
  ]);
  
  const DOORBELL = new Set([
    // ... (same as Python set)
  ]);
  
  const VERTICAL_CAMS = new Set([
    // ... (same as Python set)
  ]);
  
  const SUBSTREAM_FW = {
    // ... (same as Python dictionary)
  };
  
  const RTSP_FW = new Set([
    // ... (same as Python set)
  ]);
  
  
  