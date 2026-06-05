"use strict";

/**
 * Tutk Wyze protocol message catalog — port of every K-class in
 * docker-wyze-bridge's `app/wyzecam/tutk/tutk_protocol.py`.
 *
 * Each class represents one camera command. The base class
 * (`WyzeProtocolMessage`) handles the request/response code convention:
 * client requests are even-numbered codes, camera responses are
 * `code + 1`. Encoded bytes go on the wire via `encode()`; the camera's
 * reply is decoded via `parseResponse()`.
 *
 * 63 classes total. Grouped by source-file order. Comments cite the
 * original Python class so cross-reference stays easy.
 *
 * To use:
 *
 *   const M = require('./messages');
 *   const req = new M.K10042SetNightVisionStatus(M.NV_AUTO);
 *   const wireBytes = req.encode();   // → Buffer ready to send
 *   // ... transmit, await response ...
 *   const result = req.parseResponse(responseBytes);
 */

const { encode, decode } = require("./codec");
const { FRAME_SIZE, BITRATE } = require("./constants");

// Symbolic constants for common values — easier to read than `1` / `2`.
const ON = 1, OFF = 2;
const NV_ON = 1, NV_OFF = 2, NV_AUTO = 3;
const FLIP_OFF = 1, FLIP_ON = 2;

// ---- Base class --------------------------------------------------------

class WyzeProtocolMessage {
  /**
   * @param {number} code — 2-byte command code. Client requests are
   *   conventionally even; the matching response from the camera is
   *   `code + 1`.
   */
  constructor(code) {
    this.code = code;
    this.expectedResponseCode = code + 1;
  }

  /**
   * Default encoding — header with no body. Subclasses override when
   * they have a payload.
   * @returns {Buffer}
   */
  encode() {
    return encode(this.code, null);
  }

  /**
   * Default response parser — returns the raw response bytes.
   * Subclasses override to decode JSON, unpack structs, etc.
   * @param {Buffer} respData
   * @returns {*}
   */
  parseResponse(respData) {
    return respData;
  }

  toString() {
    return `<${this.constructor.name} code=${this.code} resp=${this.expectedResponseCode}>`;
  }
}

// ---- Auth handshake (K10000 → K10009) ----------------------------------

/**
 * K10000ConnectRequest — initial connect, sent right after the IOTC
 * session opens. Camera responds with K10001 (16 random challenge bytes).
 *
 * The optional `mac` argument switches the request to "wake from sleep"
 * mode, which battery cams need before they'll respond to anything else.
 */
class K10000ConnectRequest extends WyzeProtocolMessage {
  /** @param {string|null} mac */
  constructor(mac) {
    super(10000);
    this.mac = mac || null;
  }
  encode() {
    if (!this.mac) return encode(this.code, null);
    const wake = {
      cameraInfo: { mac: this.mac, encFlag: 0, wakeupFlag: 1 },
    };
    return encode(this.code, Buffer.from(JSON.stringify(wake), "ascii"));
  }
}

/**
 * K10002ConnectAuth — challenge response (deprecated; replaced by
 * K10008 on newer firmwares). Camera responds with K10003 (JSON status
 * + device info).
 */
class K10002ConnectAuth extends WyzeProtocolMessage {
  /**
   * @param {Buffer} challengeResponse — exactly 16 bytes (xxtea-encrypted)
   * @param {string} mac — camera mac; padded with "1234" if < 4 chars
   * @param {boolean} [video=true]
   * @param {boolean} [audio=true]
   */
  constructor(challengeResponse, mac, video = true, audio = true) {
    super(10002);
    if (challengeResponse.length !== 16) {
      throw new Error("challengeResponse must be exactly 16 bytes");
    }
    this.challengeResponse = challengeResponse;
    this.username = mac.length < 4 ? mac + "1234" : mac;
    this.video = video ? 1 : 0;
    this.audio = audio ? 1 : 0;
  }
  encode() {
    const data = Buffer.alloc(22);
    this.challengeResponse.copy(data, 0);                              // 0..16
    Buffer.from(this.username, "ascii").copy(data, 16, 0, 4);           // 16..20
    data[20] = this.video;
    data[21] = this.audio;
    return encode(this.code, data);
  }
  parseResponse(respData) {
    return JSON.parse(respData.toString("utf8"));
  }
}

/**
 * K10006ConnectUserAuth — new DB protocol version of K10002. Camera
 * responds with K10007 (JSON status).
 */
class K10006ConnectUserAuth extends WyzeProtocolMessage {
  constructor(challengeResponse, phoneId, openUserId, video = true, audio = true) {
    super(10006);
    if (challengeResponse.length !== 16) {
      throw new Error("challengeResponse must be exactly 16 bytes");
    }
    this.challengeResponse = challengeResponse;
    this.username = Buffer.from(phoneId.length < 4 ? phoneId + "1234" : phoneId, "utf8");
    this.openUserId = Buffer.from(openUserId, "utf8");
    this.video = video ? 1 : 0;
    this.audio = audio ? 1 : 0;
  }
  encode() {
    // Layout: <16s 4s b b b {N}s>
    const oidLen = this.openUserId.length;
    const data = Buffer.alloc(16 + 4 + 3 + oidLen);
    this.challengeResponse.copy(data, 0);
    this.username.copy(data, 16, 0, 4);
    data.writeInt8(this.video, 20);
    data.writeInt8(this.audio, 21);
    data.writeInt8(oidLen, 22);
    this.openUserId.copy(data, 23);
    return encode(this.code, data);
  }
  parseResponse(respData) {
    return JSON.parse(respData.toString("utf8"));
  }
}

/**
 * K10008ConnectUserAuth — newest auth, sent the open_user_id. Camera
 * responds with K10009 (JSON status + device info).
 */
class K10008ConnectUserAuth extends WyzeProtocolMessage {
  constructor(challengeResponse, phoneId, openUserId, video = true, audio = true) {
    super(10008);
    if (challengeResponse.length !== 16) {
      throw new Error("challengeResponse must be exactly 16 bytes");
    }
    this.challengeResponse = challengeResponse;
    this.username = Buffer.from(phoneId.length < 4 ? phoneId + "1234" : phoneId, "utf8");
    this.openUserId = Buffer.from(openUserId, "utf8");
    this.video = video ? 1 : 0;
    this.audio = audio ? 1 : 0;
  }
  encode() {
    const oidLen = this.openUserId.length;
    const data = Buffer.alloc(16 + 4 + 3 + oidLen);
    this.challengeResponse.copy(data, 0);
    this.username.copy(data, 16, 0, 4);
    data.writeInt8(this.video, 20);
    data.writeInt8(this.audio, 21);
    data.writeInt8(oidLen, 22);
    this.openUserId.copy(data, 23);
    return encode(this.code, data);
  }
  parseResponse(respData) {
    return JSON.parse(respData.toString("utf8"));
  }
}

// ---- Media control + camera info ---------------------------------------

/**
 * K10010ControlChannel — enable/disable a media channel.
 *
 * media_type: 1=Video, 2=Audio, 3=Return Audio, 4=RDT
 */
class K10010ControlChannel extends WyzeProtocolMessage {
  /** @param {number} mediaType 1-4 @param {boolean} enabled */
  constructor(mediaType = 1, enabled = false) {
    super(10010);
    if (mediaType <= 0 || mediaType > 4) throw new Error("media_type must be 1-4");
    this.mediaType = mediaType;
    this.enabled = enabled ? 1 : 2;
  }
  encode() { return encode(this.code, Buffer.from([this.mediaType, this.enabled])); }
}

/**
 * K10020CheckCameraInfo — read camera settings, JSON response.
 * Default count is 60 — the number of param IDs requested.
 */
class K10020CheckCameraInfo extends WyzeProtocolMessage {
  constructor(count = 60) {
    super(10020);
    this.count = count;
  }
  encode() {
    // Body: [count, 1, 2, 3, ..., count]
    const body = Buffer.alloc(1 + this.count);
    body[0] = this.count;
    for (let i = 0; i < this.count; i++) body[1 + i] = i + 1;
    return encode(this.code, body);
  }
  parseResponse(respData) { return JSON.parse(respData.toString("utf8")); }
}

/**
 * K10020CheckCameraParams — read specific param IDs (variant of K10020).
 */
class K10020CheckCameraParams extends WyzeProtocolMessage {
  constructor(...paramIds) {
    super(10020);
    this.paramIds = paramIds;
  }
  encode() {
    const body = Buffer.alloc(1 + this.paramIds.length);
    body[0] = this.paramIds.length;
    for (let i = 0; i < this.paramIds.length; i++) body[1 + i] = this.paramIds[i];
    return encode(this.code, body);
  }
  parseResponse(respData) { return JSON.parse(respData.toString("utf8")); }
}

// ---- Network LED, IR LED, night vision ---------------------------------

class K10030GetNetworkLightStatus extends WyzeProtocolMessage { constructor() { super(10030); } }
class K10032SetNetworkLightStatus extends WyzeProtocolMessage {
  /** @param {number} value 1=on, 2=off */
  constructor(value) {
    super(10032);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10040GetNightVisionStatus extends WyzeProtocolMessage { constructor() { super(10040); } }
class K10042SetNightVisionStatus extends WyzeProtocolMessage {
  /** @param {number} status 1=on, 2=off, 3=auto */
  constructor(status) {
    super(10042);
    this.status = status;
  }
  encode() { return encode(this.code, Buffer.from([this.status])); }
}

class K10044GetIRLEDStatus extends WyzeProtocolMessage { constructor() { super(10044); } }
class K10046SetIRLEDStatus extends WyzeProtocolMessage {
  constructor(value) {
    super(10046);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

// ---- Video config (K10050 + K10052 + K10056 + K10058) ------------------

class K10050GetVideoParam extends WyzeProtocolMessage { constructor() { super(10050); } }

/**
 * K10056SetResolvingBit — set resolution + bitrate. Sent automatically
 * post-auth. The frame_size value on the wire is the constant + 1.
 */
class K10056SetResolvingBit extends WyzeProtocolMessage {
  constructor(frameSize = FRAME_SIZE.P1080, bitrate = BITRATE.HD) {
    super(10056);
    this.frameSize = frameSize + 1;
    this.bitrate = bitrate;
  }
  encode() {
    // <BH> = uint8 frameSize, uint16 LE bitrate
    const body = Buffer.alloc(3);
    body.writeUInt8(this.frameSize, 0);
    body.writeUInt16LE(this.bitrate, 1);
    return encode(this.code, body);
  }
  parseResponse(respData) { return respData.length === 1 && respData[0] === 0x01; }
}

/**
 * K10052DBSetResolvingBit — doorbell variant (rotated sensor → portrait).
 * Body layout: <H B B B B> = bitrate, frameSize, fps, 0, 0.
 */
class K10052DBSetResolvingBit extends WyzeProtocolMessage {
  constructor(frameSize = FRAME_SIZE.P1080, bitrate = BITRATE.HD, fps = 0) {
    super(10052);
    this.frameSize = frameSize + 1;
    this.bitrate = bitrate;
    this.fps = fps;
  }
  encode() {
    const body = Buffer.alloc(6);
    body.writeUInt16LE(this.bitrate, 0);
    body[2] = this.frameSize;
    body[3] = this.fps;
    // body[4] and body[5] stay 0
    return encode(this.code, body);
  }
  parseResponse(respData) { return respData.length === 1 && respData[0] === 0x01; }
}

class K10052SetFPS extends WyzeProtocolMessage {
  constructor(fps = 0) { super(10052); this.fps = fps; }
  // Body layout: [0, 0, 0, fps, 0, 0]
  encode() { return encode(this.code, Buffer.from([0, 0, 0, this.fps, 0, 0])); }
}

class K10052SetBitrate extends WyzeProtocolMessage {
  constructor(bitrate = 0) { super(10052); this.bitrate = bitrate; }
  encode() {
    const body = Buffer.alloc(6);
    body.writeUInt16LE(this.bitrate, 0);
    return encode(this.code, body);
  }
}

class K10052HorizontalFlip extends WyzeProtocolMessage {
  constructor(value = 0) {
    super(10052);
    if (value <= 0 || value > 2) throw new Error("horizontal value must be 1-2");
    this.horizontal = value;
  }
  encode() { return encode(this.code, Buffer.from([0, 0, 0, 0, this.horizontal, 0])); }
}

class K10052VerticalFlip extends WyzeProtocolMessage {
  constructor(value = 0) {
    super(10052);
    if (value <= 0 || value > 2) throw new Error("vertical value must be 1-2");
    this.vertical = value;
  }
  encode() { return encode(this.code, Buffer.from([0, 0, 0, 0, 0, this.vertical])); }
}

class K10058TakePhoto extends WyzeProtocolMessage {
  constructor() { super(10058); }
  encode() { return encode(this.code, Buffer.from([1])); }
}

// ---- OSD + time --------------------------------------------------------

class K10070GetOSDStatus extends WyzeProtocolMessage { constructor() { super(10070); } }
class K10072SetOSDStatus extends WyzeProtocolMessage {
  constructor(value) {
    super(10072);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10074GetOSDLogoStatus extends WyzeProtocolMessage { constructor() { super(10074); } }
class K10076SetOSDLogoStatus extends WyzeProtocolMessage {
  constructor(value) {
    super(10076);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10090GetCameraTime extends WyzeProtocolMessage {
  constructor() { super(10090); }
  parseResponse(respData) {
    // Read as little-endian unsigned int up to 8 bytes. Camera typically
    // sends 4 bytes (uint32 unix timestamp), but tolerate longer values.
    let v = 0n;
    for (let i = respData.length - 1; i >= 0; i--) {
      v = (v << 8n) | BigInt(respData[i]);
    }
    return Number(v);
  }
}

/**
 * K10092SetCameraTime — sync camera time to host. Body is the current
 * Unix timestamp as uint32 LE. Caller can override the timestamp by
 * passing a number (seconds since epoch); defaults to Date.now() / 1000.
 */
class K10092SetCameraTime extends WyzeProtocolMessage {
  constructor(unixSec) {
    super(10092);
    this.timestamp = unixSec != null ? unixSec : Math.floor(Date.now() / 1000);
  }
  encode() {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(this.timestamp >>> 0, 0);
    return encode(this.code, body);
  }
}

// ---- Motion ------------------------------------------------------------

class K10290GetMotionTagging extends WyzeProtocolMessage { constructor() { super(10290); } }

class K10200GetMotionAlarm extends WyzeProtocolMessage {
  constructor() { super(10200); }
  parseResponse(respData) {
    // <BB> = enabled, sensitivity. Python returns just enabled.
    return respData[0];
  }
}

class K10202SetMotionAlarm extends WyzeProtocolMessage {
  constructor(value) {
    super(10202);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value, 0])); }
}

class K10206SetMotionAlarm extends WyzeProtocolMessage {
  constructor(value) {
    super(10206);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value, 0])); }
}

class K10292SetMotionTagging extends WyzeProtocolMessage {
  constructor(value) {
    super(10292);
    if (value < 0 || value > 2) throw new Error("value must be 0-2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10302SetTimeZone extends WyzeProtocolMessage {
  constructor(value) {
    super(10302);
    if (value < -11 || value > 13) throw new Error("value must be -11 to 13");
    this.value = value;
  }
  encode() {
    // <b> = signed int8
    const body = Buffer.alloc(1);
    body.writeInt8(this.value, 0);
    return encode(this.code, body);
  }
}

// ---- Night vision conditions + spotlight/alarm -------------------------

class K10620CheckNight extends WyzeProtocolMessage { constructor() { super(10620); } }
class K10624GetAutoSwitchNightType extends WyzeProtocolMessage { constructor() { super(10624); } }

/**
 * K10626SetAutoSwitchNightType — set when NV kicks in.
 * type: 1=dusk (low light), 2=dark (extremely low light)
 */
class K10626SetAutoSwitchNightType extends WyzeProtocolMessage {
  constructor(type) {
    super(10626);
    this.type = type;
  }
  encode() { return encode(this.code, Buffer.from([this.type])); }
}

/**
 * K10630SetAlarmFlashing — controls both alarm AND siren on the camera.
 * Body is [value, value].
 */
class K10630SetAlarmFlashing extends WyzeProtocolMessage {
  constructor(value) {
    super(10630);
    if (value < 0 || value > 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value, this.value])); }
}

class K10632GetAlarmFlashing extends WyzeProtocolMessage { constructor() { super(10632); } }
class K10640GetSpotlightStatus extends WyzeProtocolMessage { constructor() { super(10640); } }

/**
 * K10646SetSpotlightStatus — for WYZEC3L (cam with spotlight).
 */
class K10646SetSpotlightStatus extends WyzeProtocolMessage {
  constructor(value) {
    super(10646);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

// ---- Storage + utility -------------------------------------------------

class K10148StartBoa extends WyzeProtocolMessage {
  constructor() { super(10148); }
  encode() { return encode(this.code, Buffer.from([0, 1, 0, 0, 0])); }
}

class K10242FormatSDCard extends WyzeProtocolMessage {
  constructor(value = 0) {
    super(10242);
    if (value !== 1) throw new Error("value must be 1 to confirm format!");
    this.value = value;
  }
}

// ---- Outdoor cam state / battery ---------------------------------------

class K10444SetDeviceState extends WyzeProtocolMessage {
  constructor(value = 1) {
    super(10444);
    if (value < 0 || value > 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10446CheckConnStatus extends WyzeProtocolMessage {
  constructor() { super(10446); }
  parseResponse(respData) { return JSON.parse(respData.toString("utf8")); }
}

class K10448GetBatteryUsage extends WyzeProtocolMessage {
  constructor() { super(10448); }
  parseResponse(respData) {
    const data = JSON.parse(respData.toString("utf8"));
    return {
      last_charge:      data["0"],
      live_streaming:   data["1"],
      events_uploaded:  data["2"],
      events_filtered:  data["3"],
      sd_recordings:    data["4"],
      "5":              data["5"],
    };
  }
}

// ---- RTSP --------------------------------------------------------------

class K10600SetRtspSwitch extends WyzeProtocolMessage {
  constructor(value = 1) {
    super(10600);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K10604GetRtspParam extends WyzeProtocolMessage { constructor() { super(10604); } }

// ---- PTZ / Cruise ------------------------------------------------------

class K11000SetRotaryByDegree extends WyzeProtocolMessage {
  constructor(horizontal, vertical = 0, speed = 5) {
    super(11000);
    this.horizontal = horizontal;
    this.vertical = vertical;
    this.speed = (speed > 1 && speed < 9) ? speed : 5;
  }
  encode() {
    // <hhB> = int16 LE × 2 then uint8 = 5 bytes total
    const body = Buffer.alloc(5);
    body.writeInt16LE(this.horizontal, 0);
    body.writeInt16LE(this.vertical, 2);
    body.writeUInt8(this.speed, 4);
    return encode(this.code, body);
  }
}

class K11002SetRotaryByAction extends WyzeProtocolMessage {
  /**
   * @param {number} horizontal 0=none, 1=left, 2=right
   * @param {number} vertical   0=none, 1=up,   2=down
   * @param {number} [speed=5]  1..9
   */
  constructor(horizontal, vertical, speed = 5) {
    super(11002);
    this.horizontal = (horizontal >= 0 && horizontal <= 2) ? horizontal : 0;
    this.vertical   = (vertical   >= 0 && vertical   <= 2) ? vertical   : 0;
    this.speed      = (speed >= 1 && speed <= 9) ? speed : 5;
  }
  encode() { return encode(this.code, Buffer.from([this.horizontal, this.vertical, this.speed])); }
}

class K11004ResetRotatePosition extends WyzeProtocolMessage {
  constructor(position = 3) { super(11004); this.position = position; }
  encode() { return encode(this.code, Buffer.from([this.position])); }
}

class K11006GetCurCruisePoint extends WyzeProtocolMessage {
  constructor() { super(11006); }
  encode() {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(Math.floor(Date.now() / 1000) >>> 0, 0);
    return encode(this.code, body);
  }
  parseResponse(respData) {
    // <IBH> = uint32, uint8, uint16. Python returns dict with [1] (uint8) and [2] (uint16).
    return {
      vertical:   respData.readUInt8(4),
      horizontal: respData.readUInt16LE(5),
    };
  }
}

class K11010GetCruisePoints extends WyzeProtocolMessage {
  constructor() { super(11010); }
  parseResponse(respData) {
    // First byte is the count, then iter_unpack("<BHB") starting at offset 1.
    // Each cruise point is 4 bytes: vertical (uint8), horizontal (uint16 LE), time (uint8)
    const out = [];
    let off = 1;
    while (off + 4 <= respData.length) {
      out.push({
        vertical:   respData.readUInt8(off),
        horizontal: respData.readUInt16LE(off + 1),
        time:       respData.readUInt8(off + 3),
      });
      off += 4;
    }
    return out;
  }
}

class K11012SetCruisePoints extends WyzeProtocolMessage {
  /**
   * @param {Array<{vertical: number, horizontal: number, time?: number}>} points
   * @param {number} [waitTime=10]
   */
  constructor(points, waitTime = 10) {
    super(11012);
    const body = Buffer.alloc(1 + points.length * 4);
    body[0] = points.length;
    let off = 1;
    for (const p of points) {
      body.writeUInt8(p.vertical || 0, off);
      body.writeUInt16LE(p.horizontal || 0, off + 1);
      body.writeUInt8(p.time != null ? p.time : waitTime, off + 3);
      off += 4;
    }
    this.body = body;
  }
  encode() { return encode(this.code, this.body); }
}

class K11014GetCruise extends WyzeProtocolMessage { constructor() { super(11014); } }
class K11016SetCruise extends WyzeProtocolMessage {
  constructor(value) {
    super(11016);
    if (value < 0 || value > 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

class K11018SetPTZPosition extends WyzeProtocolMessage {
  constructor(vertical = 0, horizontal = 0) {
    super(11018);
    this.vertical = vertical;
    this.horizontal = horizontal;
  }
  encode() {
    // Python: time_val = int(time.time() * 1000) % 1_000_000_000
    const timeVal = Math.floor(Date.now()) % 1_000_000_000;
    const body = Buffer.alloc(7);
    body.writeUInt32LE(timeVal >>> 0, 0);
    body.writeUInt8(this.vertical, 4);
    body.writeUInt16LE(this.horizontal, 5);
    return encode(this.code, body);
  }
}

class K11020GetMotionTracking extends WyzeProtocolMessage { constructor() { super(11020); } }
class K11022SetMotionTracking extends WyzeProtocolMessage {
  constructor(value) {
    super(11022);
    if (value < 0 || value > 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

/**
 * K11635ResponseQuickMessage — doorbell quick reply (Can I help you / Be
 * there shortly / Leave package at door).
 */
class K11635ResponseQuickMessage extends WyzeProtocolMessage {
  constructor(value) {
    super(11635);
    if (value < 1 || value > 3) throw new Error("value must be 1, 2 or 3");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

// ---- Accessories + floodlight ------------------------------------------

class K10720GetAccessoriesInfo extends WyzeProtocolMessage {
  constructor() { super(10720); }
  parseResponse(respData) { return JSON.parse(respData.toString("utf8")); }
}

class K10788GetIntegratedFloodlightInfo extends WyzeProtocolMessage { constructor() { super(10788); } }
class K10820GetWhiteLightInfo extends WyzeProtocolMessage { constructor() { super(10820); } }

class K12060SetFloodLightSwitch extends WyzeProtocolMessage {
  constructor(value) {
    super(12060);
    if (value !== 1 && value !== 2) throw new Error("value must be 1 or 2");
    this.value = value;
  }
  encode() { return encode(this.code, Buffer.from([this.value])); }
}

// ---- Exports -----------------------------------------------------------

module.exports = {
  // Base + helpers
  WyzeProtocolMessage,
  // Convenience constants
  ON, OFF, NV_ON, NV_OFF, NV_AUTO, FLIP_ON, FLIP_OFF,
  // Auth
  K10000ConnectRequest, K10002ConnectAuth, K10006ConnectUserAuth, K10008ConnectUserAuth,
  // Media + check
  K10010ControlChannel, K10020CheckCameraInfo, K10020CheckCameraParams,
  // LEDs + night vision
  K10030GetNetworkLightStatus, K10032SetNetworkLightStatus,
  K10040GetNightVisionStatus,  K10042SetNightVisionStatus,
  K10044GetIRLEDStatus,        K10046SetIRLEDStatus,
  // Video
  K10050GetVideoParam, K10056SetResolvingBit, K10052DBSetResolvingBit,
  K10052SetFPS, K10052SetBitrate, K10052HorizontalFlip, K10052VerticalFlip,
  K10058TakePhoto,
  // OSD + time
  K10070GetOSDStatus, K10072SetOSDStatus, K10074GetOSDLogoStatus, K10076SetOSDLogoStatus,
  K10090GetCameraTime, K10092SetCameraTime,
  // Motion
  K10290GetMotionTagging, K10200GetMotionAlarm, K10202SetMotionAlarm, K10206SetMotionAlarm,
  K10292SetMotionTagging, K10302SetTimeZone,
  // Night/alarm/spotlight
  K10620CheckNight, K10624GetAutoSwitchNightType, K10626SetAutoSwitchNightType,
  K10630SetAlarmFlashing, K10632GetAlarmFlashing, K10640GetSpotlightStatus, K10646SetSpotlightStatus,
  // Storage/utility
  K10148StartBoa, K10242FormatSDCard,
  // Outdoor cam state
  K10444SetDeviceState, K10446CheckConnStatus, K10448GetBatteryUsage,
  // RTSP
  K10600SetRtspSwitch, K10604GetRtspParam,
  // PTZ + Cruise
  K11000SetRotaryByDegree, K11002SetRotaryByAction, K11004ResetRotatePosition,
  K11006GetCurCruisePoint, K11010GetCruisePoints, K11012SetCruisePoints,
  K11014GetCruise, K11016SetCruise, K11018SetPTZPosition,
  K11020GetMotionTracking, K11022SetMotionTracking,
  K11635ResponseQuickMessage,
  // Accessories
  K10720GetAccessoriesInfo, K10788GetIntegratedFloodlightInfo,
  K10820GetWhiteLightInfo, K12060SetFloodLightSwitch,
};
