import xxtea from 'xxtea';
import { LittleEndianStructure, c_char, c_uint16, c_uint32 } from 'ctypes';
import { encode, decode } from 'struct';
import { Path } from 'path';
import { getenv } from 'os';
import { json, logging, time } from 'python';
import { DOORBELL } from 'wyzecam.api_models';
import tutk from './tutk';

const PROJECT_ROOT = Path(getenv("TUTK_PROJECT_ROOT", Path(__file__).parent));
const logger = logging.getLogger(__name__);

class TutkWyzeProtocolError extends tutk.TutkError {
    constructor() {
        super();
    }
}

class TutkWyzeProtocolHeader extends LittleEndianStructure {
    constructor() {
        super();
        this._pack_ = 1;
        this._fields_ = [
            ["prefix", c_char * 2],
            ["protocol", c_uint16],
            ["code", c_uint16],
            ["txt_len", c_uint32],
            ["reserved2", c_uint16],
            ["reserved3", c_uint32]
        ];
    }

    __repr__() {
        const classname = this.__class__.__name__;
        return (
            `<${classname} ` +
            `prefix=${this.prefix} ` +
            `protocol=${this.protocol} ` +
            `code=${this.code} ` +
            `txt_len=${this.txt_len}>`
        );
    }
}

class TutkWyzeProtocolMessage {
    constructor(code) {
        this.code = code;
        this.expected_response_code = code + 1;
    }

    encode() {
        return encode(this.code, null);
    }

    parse_response(resp_data) {
        return resp_data;
    }

    __repr__() {
        return `<${this.__class__.__name__} code=${this.code} resp_code=${this.expected_response_code}>`;
    }
}

class K10000ConnectRequest extends TutkWyzeProtocolMessage {
    constructor(mac) {
        super(10000);
        this.mac = mac;
    }

    encode() {
        if (!this.mac) {
            return encode(this.code, null);
        }
        const wake_dict = {
            "cameraInfo": {
                "mac": this.mac,
                "encFlag": 0,
                "wakeupFlag": 1,
            }
        };
        const wake_json = json.dumps(wake_dict, separators=(",", ":")).encode("ascii");
        return encode(this.code, wake_json);
    }
}

class K10002ConnectAuth extends TutkWyzeProtocolMessage {
    constructor(challenge_response, mac, video = true, audio = true) {
        super(10002);
        assert(
            challenge_response.length == 16,
            "expected challenge response to be 16 bytes long"
        );
        if (mac.length < 4) {
            mac += "1234";
        }
        this.challenge_response = challenge_response;
        this.username = mac;
        this.video = video;
        this.audio = audio;
    }

    encode() {
        const data = new Uint8Array(22);
        data.set(this.challenge_response, 0);
        data.set(this.username.encode("ascii").slice(0, 4), 16);
        data[20] = this.video ? 1 : 0;
        data[21] = this.audio ? 1 : 0;
        return encode(this.code, data);
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10006ConnectUserAuth extends TutkWyzeProtocolMessage {
    constructor(
        challenge_response,
        phone_id,
        open_userid,
        video = true,
        audio = true
    ) {
        super(10006);
        assert(
            challenge_response.length == 16,
            "expected challenge response to be 16 bytes long"
        );
        if (phone_id.length < 4) {
            phone_id += "1234";
        }
        this.challenge_response = challenge_response;
        this.username = phone_id.encode("utf-8");
        this.open_userid = open_userid.encode("utf-8");
        this.video = video ? 1 : 0;
        this.audio = audio ? 1 : 0;
    }

    encode() {
        const open_userid_len = this.open_userid.length;
        const encoded_msg = pack(
            `<16s4sbbb${open_userid_len}s`,
            this.challenge_response,
            this.username,
            this.video,
            this.audio,
            open_userid_len,
            this.open_userid
        );
        return encode(this.code, encoded_msg);
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10008ConnectUserAuth extends TutkWyzeProtocolMessage {
    constructor(
        challenge_response,
        phone_id,
        open_userid,
        video = true,
        audio = true
    ) {
        super(10008);
        assert(
            challenge_response.length == 16,
            "expected challenge response to be 16 bytes long"
        );
        if (phone_id.length < 4) {
            phone_id += "1234";
        }
        this.challenge_response = challenge_response;
        this.username = phone_id.encode("utf-8");
        this.open_userid = open_userid.encode("utf-8");
        this.video = video ? 1 : 0;
        this.audio = audio ? 1 : 0;
    }

    encode() {
        const open_userid_len = this.open_userid.length;
        const encoded_msg = pack(
            `<16s4sbbb${open_userid_len}s`,
            this.challenge_response,
            this.username,
            this.video,
            this.audio,
            open_userid_len,
            this.open_userid
        );
        return encode(this.code, encoded_msg);
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10010ControlChannel extends TutkWyzeProtocolMessage {
    constructor(media_type = 1, enabled = false) {
        super(10010);
        assert(0 < media_type <= 4, "control channel media_type must be 1-4");
        this.media_type = media_type;
        this.enabled = enabled ? 1 : 2;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.media_type, this.enabled]));
    }
}

class K10020CheckCameraInfo extends TutkWyzeProtocolMessage {
    constructor(count = 60) {
        super(10020);
        this.count = count;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.count, ...range(1, this.count + 1)]));
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10020CheckCameraParams extends TutkWyzeProtocolMessage {
    constructor(...param_id) {
        super(10020);
        this.param_id = param_id;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.param_id.length, ...this.param_id]));
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10030GetNetworkLightStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10030);
    }
}

class K10032SetNetworkLightStatus extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10032);
        assert(0 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10040GetNightVisionStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10040);
    }
}

class K10042SetNightVisionStatus extends TutkWyzeProtocolMessage {
    constructor(status) {
        super(10042);
        this.status = status;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.status]));
    }
}

class K10044GetIRLEDStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10044);
    }
}

class K10046SetIRLEDStatus extends TutkWyzeProtocolMessage {
    constructor(status) {
        super(10046);
        this.status = status;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.status]));
    }
}

class K10050GetVideoParam extends TutkWyzeProtocolMessage {
    constructor() {
        super(10050);
    }

    parse_response(resp_data) {
        return {
            "bitrate": resp_data[0],
            "res": resp_data[2],
            "fps": resp_data[3],
            "hor_flip": resp_data[4],
            "ver_flip": resp_data[5],
        };
    }
}

class K10056SetResolvingBit extends TutkWyzeProtocolMessage {
    constructor(frame_size = tutk.FRAME_SIZE_1080P, bitrate = tutk.BITRATE_HD, fps = 0) {
        super(10056);
        this.frame_size = frame_size + 1;
        this.bitrate = bitrate;
        this.fps = fps;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.frame_size, this.bitrate, this.fps]));
    }

    parse_response(resp_data) {
        return resp_data == b"\x01";
    }
}

class K10052DBSetResolvingBit extends TutkWyzeProtocolMessage {
    constructor(frame_size = tutk.FRAME_SIZE_1080P, bitrate = tutk.BITRATE_HD, fps = 0) {
        super(10052);
        assert(0 <= bitrate <= 255, "bitrate value must be 1-255");
        this.frame_size = frame_size + 1;
        this.bitrate = bitrate;
        this.fps = fps;
    }

    encode() {
        const payload = new Uint8Array([this.bitrate, 0, this.frame_size, this.fps, 0, 0]);
        return encode(this.code, payload);
    }

    parse_response(resp_data) {
        return resp_data == b"\x01";
    }
}

class K10052SetFPS extends TutkWyzeProtocolMessage {
    constructor(fps = 0) {
        super(10052);
        this.fps = fps;
    }

    encode() {
        return encode(this.code, new Uint8Array([0, 0, 0, this.fps, 0, 0]));
    }
}

class K10052SetBitrate extends TutkWyzeProtocolMessage {
    constructor(value = 0) {
        super(10052);
        assert(0 < value <= 255, "bitrate value must be 1-255");
        this.bitrate = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.bitrate, 0, 0, 0, 0, 0]));
    }
}

class K10052HorizontalFlip extends TutkWyzeProtocolMessage {
    constructor(value = 0) {
        super(10052);
        assert(0 < value <= 2, "horizontal value must be 1-2");
        this.horizontal = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([0, 0, 0, 0, this.horizontal, 0]));
    }
}

class K10052VerticalFlip extends TutkWyzeProtocolMessage {
    constructor(value = 0) {
        super(10052);
        assert(0 < value <= 2, "vertical value must be 1-2");
        this.vertical = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([0, 0, 0, 0, 0, this.vertical]));
    }
}

class K10070GetOSDStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10070);
    }
}

class K10072SetOSDStatus extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10072);
        assert(1 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10074GetOSDLogoStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10074);
    }
}

class K10076SetOSDLogoStatus extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10076);
        assert(1 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10090GetCameraTime extends TutkWyzeProtocolMessage {
    constructor() {
        super(10090);
    }

    parse_response(resp_data) {
        return int.from_bytes(resp_data, "little");
    }
}

class K10092SetCameraTime extends TutkWyzeProtocolMessage {
    constructor(_) {
        super(10092);
    }

    encode() {
        return encode(this.code, pack("<I", int(time.time()) + 1));
    }
}

class K10290GetMotionTagging extends TutkWyzeProtocolMessage {
    constructor() {
        super(10290);
    }
}

class K10292SetMotionTagging extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10292);
        assert(0 <= value <= 2);
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10302SetTimeZone extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10302);
        assert(-11 <= value <= 13, "value must be -11 to 13");
        this.value = value;
    }

    encode() {
        return encode(this.code, pack("<b", this.value));
    }
}

class K10620CheckNight extends TutkWyzeProtocolMessage {
    constructor() {
        super(10620);
    }
}

class K10624GetAutoSwitchNightType extends TutkWyzeProtocolMessage {
    constructor() {
        super(10624);
    }
}

class K10626SetAutoSwitchNightType extends TutkWyzeProtocolMessage {
    constructor(type) {
        super(10626);
        this.type = type;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.type]));
    }
}

class K10630SetAlarmFlashing extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10630);
        assert(0 <= value <= 2);
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value, this.value]));
    }
}

class K10632GetAlarmFlashing extends TutkWyzeProtocolMessage {
    constructor() {
        super(10632);
    }
}

class K10640GetSpotlightStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10640);
    }
}

class K10058TakePhoto extends TutkWyzeProtocolMessage {
    constructor() {
        super(10058);
    }
}

class K10148StartBoa extends TutkWyzeProtocolMessage {
    constructor() {
        super(10148);
    }

    encode() {
        return encode(this.code, new Uint8Array([0, 1, 0, 0, 0]));
    }
}

class K10242FormatSDCard extends TutkWyzeProtocolMessage {
    constructor(value = 0) {
        super(10242);
        assert(value == 1, "value must be 1 to confirm format!");
    }
}

class K10444SetDeviceState extends TutkWyzeProtocolMessage {
    constructor(value = 1) {
        super(10444);
        assert(0 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10446CheckConnStatus extends TutkWyzeProtocolMessage {
    constructor() {
        super(10446);
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10448GetBatteryUsage extends TutkWyzeProtocolMessage {
    constructor() {
        super(10448);
    }

    parse_response(resp_data) {
        const data = json.loads(resp_data);
        return {
            "last_charge": data["0"],
            "live_streaming": data["1"],
            "events_uploaded": data["2"],
            "events_filtered": data["3"],
            "sd_recordings": data["4"],
            "5": data["5"],
        };
    }
}

class K10600SetRtspSwitch extends TutkWyzeProtocolMessage {
    constructor(value = 1) {
        super(10600);
        assert(1 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10604GetRtspParam extends TutkWyzeProtocolMessage {
    constructor() {
        super(10604);
    }
}

class K11000SetRotaryByDegree extends TutkWyzeProtocolMessage {
    constructor(horizontal, vertical = 0, speed = 5) {
        super(11000);
        this.horizontal = horizontal;
        this.vertical = vertical;
        this.speed = speed > 1 && speed < 9 ? speed : 5;
    }

    encode() {
        const msg = pack("<hhB", this.horizontal, this.vertical, this.speed);
        return encode(this.code, msg);
    }
}

class K11002SetRotaryByAction extends TutkWyzeProtocolMessage {
    constructor(horizontal, vertical, speed = 5) {
        super(11002);
        this.horizontal = horizontal >= 0 && horizontal <= 2 ? horizontal : 0;
        this.vertical = vertical >= 0 && vertical <= 2 ? vertical : 0;
        this.speed = speed >= 1 && speed <= 9 ? speed : 5;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.horizontal, this.vertical, this.speed]));
    }
}

class K11004ResetRotatePosition extends TutkWyzeProtocolMessage {
    constructor(position = 3) {
        super(11004);
        this.position = position;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.position]));
    }
}

class K11006GetCurCruisePoint extends TutkWyzeProtocolMessage {
    constructor() {
        super(11010);
    }

    encode() {
        return encode(this.code, pack("<I", int(time.time())));
    }

    parse_response(resp_data) {
        return {
            "vertical": resp_data[1],
            "horizontal": resp_data[2],
            "time": resp_data[3],
            "blank": resp_data[4],
        };
    }
}

class K11010GetCruisePoints extends TutkWyzeProtocolMessage {
    constructor() {
        super(11010);
    }

    parse_response(resp_data) {
        return [
            {
                "vertical": resp_data[i + 1],
                "horizontal": resp_data[i + 2],
                "time": resp_data[i + 3],
                "blank": resp_data[i + 4],
            }
            for (let i = 0; i < resp_data[0] * 4; i += 4)
        ];
    }
}

class K11012SetCruisePoints extends TutkWyzeProtocolMessage {
    constructor(points, wait_time = 10) {
        super(11012);
        const cruise_points = [0];
        for (let count = 1; count <= points.length; count++) {
            const point = points[count - 1];
            cruise_points[0] = count;
            cruise_points.push(
                point.get("vertical", 0),
                point.get("horizontal", 0),
                point.get("time", wait_time),
                point.get("blank", 0)
            );
        }
        this.points = cruise_points;
    }

    encode() {
        return encode(this.code, new Uint8Array(this.points));
    }
}

class K11014GetCruise extends TutkWyzeProtocolMessage {
    constructor() {
        super(11014);
    }
}

class K11016SetCruise extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(11016);
        assert(0 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K11018SetPTZPosition extends TutkWyzeProtocolMessage {
    constructor(vertical = 0, horizontal = 0) {
        super(11018);
        this.vertical = vertical;
        this.horizontal = horizontal;
    }

    encode() {
        const time_val = (time.time() * 1000) % 1_000_000_000;
        return encode(this.code, pack("<IBH", time_val, this.vertical, this.horizontal));
    }
}

class K11020GetMotionTracking extends TutkWyzeProtocolMessage {
    constructor() {
        super(11020);
    }
}

class K11022SetMotionTracking extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(11022);
        assert(0 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K11635ResponseQuickMessage extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(11635);
        assert(1 <= value <= 3, "value must be 1, 2 or 3");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10646SetSpotlightStatus extends TutkWyzeProtocolMessage {
    constructor(value) {
        super(10646);
        assert(1 <= value <= 2, "value must be 1 or 2");
        this.value = value;
    }

    encode() {
        return encode(this.code, new Uint8Array([this.value]));
    }
}

class K10720GetAccessoriesInfo extends TutkWyzeProtocolMessage {
    constructor() {
        super(10720);
    }

    parse_response(resp_data) {
        return json.loads(resp_data);
    }
}

class K10788GetIntegratedFloodlightInfo extends TutkWyzeProtocolMessage {
    constructor() {
        super(10788);
    }
}

class K10820GetWhiteLightInfo extends TutkWyzeProtocolMessage {
    constructor() {
        super(10820);
    }
}

class K12060SetFloodLightSwitch extends TutkWyzeProtocolMessage {
    constructor(value) {
      super(12060);
      if (!(1 <= value && value <= 2)) {
        throw new Error("value must be 1 or 2");
      }
      this.value = value;
    }
    encode() {
      return encode(this.code, Buffer.from([this.value]));
    }
  }
  
  function encode(code, data) {
    data = data || Buffer.alloc(0);
    return Buffer.alloc(18 + data.length, (buffer) => {
      buffer.writeUInt8(72, 0); // 'H'
      buffer.writeUInt8(76, 1); // 'L'
      buffer.writeUInt16LE(5, 2);
      buffer.writeUInt16LE(code, 4);
      buffer.writeUInt16LE(data.length, 6);
      // 8 bytes of padding
      data.copy(buffer, 16);
    });
  }
  
  function decode(buf) {
    if (buf.length < 16) {
      throw new Error("IOCtrl message too short");
    }
    let header = {
      prefix: buf.slice(0, 2).toString(),
      txt_len: buf.readUInt16LE(14)
    };
    if (header.prefix !== "HL") {
      throw new Error("IOCtrl message should begin with the prefix 'HL'");
    }
    let expected_size = header.txt_len + 16;
    if (buf.length !== expected_size) {
      throw new Error(`Encoded length doesn't match message size (header says ${expected_size}, got message of len ${buf.length})`);
    }
    return [header, header.txt_len > 0 ? buf.slice(16, expected_size) : null];
  }
  
  const STATUS_MESSAGES = {2: "updating", 4: "checking enr", 5: "off"};
  
  function respond_to_ioctrl_10001(
    data,
    protocol,
    enr,
    product_model,
    mac,
    phone_id,
    open_userid,
    audio = false
  ) {
    let camera_status = data.readUInt8(0);
    let camera_enr_b = data.slice(1, 17);
    if (STATUS_MESSAGES[camera_status]) {
      console.warn(`Camera is ${STATUS_MESSAGES[camera_status]}, can't auth.`);
      return;
    }
    if (![1, 3, 6].includes(camera_status)) {
      console.warn(`Unexpected mode for connect challenge response (10001): ${camera_status}`);
      return;
    }
    let resp = generate_challenge_response(camera_enr_b, enr, camera_status);
    let response;
    if (DOORBELL.includes(product_model) && supports(product_model, protocol, 10006)) {
      response = new K10006ConnectUserAuth(resp, phone_id, open_userid, audio);
    } else if (supports(product_model, protocol, 10008)) {
      response = new K10008ConnectUserAuth(resp, phone_id, open_userid, audio);
    } else {
      response = new K10002ConnectAuth(resp, mac, audio);
    }
    console.debug(`Sending response: ${response}`);
    return response;
  }
  
  function generate_challenge_response(camera_enr_b, enr, camera_status) {
    let camera_secret_key;
    if (camera_status === 3) {
      if (enr.length < 16) {
        throw new Error("Enr expected to be 16 bytes");
      }
      camera_secret_key = enr.slice(0, 16);
    } else if (camera_status === 6) {
      if (enr.length < 32) {
        throw new Error("Enr expected to be 32 bytes");
      }
      let secret_key = enr.slice(0, 16);
      camera_enr_b = xxtea.decrypt(camera_enr_b, secret_key, {padding: false});
      camera_secret_key = enr.slice(16, 32);
    } else {
      camera_secret_key = "FFFFFFFFFFFFFFFF";
    }
    return xxtea.decrypt(camera_enr_b, camera_secret_key, {padding: false});
  }
  
  function supports(product_model, protocol, command) {
    let device_config = require(PROJECT_ROOT + "/device_config.json");
    let commands_db = device_config.supportedCommands;
    let supported_commands = [];
    for (let k in commands_db.default) {
      if (parseInt(k) <= protocol) {
        supported_commands.push(...commands_db.default[k]);
      }
    }
    if (commands_db[product_model]) {
      for (let k in commands_db[product_model]) {
        if (parseInt(k) <= protocol) {
          supported_commands.push(...commands_db[product_model][k]);
        }
      }
    }
    return supported_commands.includes(command.toString());
  }
  
  
  