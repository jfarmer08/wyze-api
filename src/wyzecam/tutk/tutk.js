const tutk_platform_lib = require('tutk_platform_lib');

const BITRATE_360P = 0x1E;
const BITRATE_SD = 0x3C;
const BITRATE_HD = 0x78;
const BITRATE_SUPER_HD = 0x96;
const BITRATE_SUPER_SUPER_HD = 0xF0;
const FRAME_SIZE_2K = 3;
const FRAME_SIZE_1080P = 0;
const FRAME_SIZE_360P = 1;
const FRAME_SIZE_DOORBELL_HD = 3;
const FRAME_SIZE_DOORBELL_SD = 4;
const IOTYPE_USER_DEFINED_START = 256;
const AV_ER_TIMEOUT = -20011;
const AV_ER_SESSION_CLOSE_BY_REMOTE = -20015;
const AV_ER_REMOTE_TIMEOUT_DISCONNECT = -20016;
const AV_ER_DATA_NOREADY = -20012;
const AV_ER_INCOMPLETE_FRAME = -20013;
const AV_ER_LOSED_THIS_FRAME = -20014;

const project_root = __dirname;

class TutkError extends Error {
    static name_mapping = {
        "-1": "IOTC_ER_SERVER_NOT_RESPONSE",
        "-2": "IOTC_ER_FAIL_RESOLVE_HOSTNAME",
        "-3": "IOTC_ER_ALREADY_INITIALIZED",
        "-4": "IOTC_ER_FAIL_CREATE_MUTEX",
        "-5": "IOTC_ER_FAIL_CREATE_THREAD",
        "-6": "IOTC_ER_FAIL_CREATE_SOCKET",
        "-7": "IOTC_ER_FAIL_SOCKET_OPT",
        "-8": "IOTC_ER_FAIL_SOCKET_BIND",
        "-10": "IOTC_ER_UNLICENSE",
        "-11": "IOTC_ER_LOGIN_ALREADY_CALLED",
        "-12": "IOTC_ER_NOT_INITIALIZED",
        "-13": "IOTC_ER_TIMEOUT",
        "-14": "IOTC_ER_INVALID_SID",
        "-15": "IOTC_ER_UNKNOWN_DEVICE",
        "-16": "IOTC_ER_FAIL_GET_LOCAL_IP",
        "-17": "IOTC_ER_LISTEN_ALREADY_CALLED",
        "-18": "IOTC_ER_EXCEED_MAX_SESSION",
        "-19": "IOTC_ER_CAN_NOT_FIND_DEVICE",
        "-20": "IOTC_ER_CONNECT_IS_CALLING",
        "-22": "IOTC_ER_SESSION_CLOSE_BY_REMOTE",
        "-23": "IOTC_ER_REMOTE_TIMEOUT_DISCONNECT",
        "-24": "IOTC_ER_DEVICE_NOT_LISTENING",
        "-26": "IOTC_ER_CH_NOT_ON",
        "-27": "IOTC_ER_FAIL_CONNECT_SEARCH",
        "-28": "IOTC_ER_MASTER_TOO_FEW",
        "-29": "IOTC_ER_AES_CERTIFY_FAIL",
        "-31": "IOTC_ER_SESSION_NO_FREE_CHANNEL",
        "-32": "IOTC_ER_TCP_TRAVEL_FAILED",
        "-33": "IOTC_ER_TCP_CONNECT_TO_SERVER_FAILED",
        "-34": "IOTC_ER_CLIENT_NOT_SECURE_MODE",
        "-35": "IOTC_ER_CLIENT_SECURE_MODE",
        "-36": "IOTC_ER_DEVICE_NOT_SECURE_MODE",
        "-37": "IOTC_ER_DEVICE_SECURE_MODE",
        "-38": "IOTC_ER_INVALID_MODE",
        "-39": "IOTC_ER_EXIT_LISTEN",
        "-40": "IOTC_ER_NO_PERMISSION",
        "-41": "IOTC_ER_NETWORK_UNREACHABLE",
        "-42": "IOTC_ER_FAIL_SETUP_RELAY",
        "-43": "IOTC_ER_NOT_SUPPORT_RELAY",
        "-44": "IOTC_ER_NO_SERVER_LIST",
        "-45": "IOTC_ER_DEVICE_MULTI_LOGIN",
        "-46": "IOTC_ER_INVALID_ARG",
        "-47": "IOTC_ER_NOT_SUPPORT_PE",
        "-48": "IOTC_ER_DEVICE_EXCEED_MAX_SESSION",
        "-49": "IOTC_ER_BLOCKED_CALL",
        "-50": "IOTC_ER_SESSION_CLOSED",
        "-51": "IOTC_ER_REMOTE_NOT_SUPPORTED",
        "-52": "IOTC_ER_ABORTED",
        "-53": "IOTC_ER_EXCEED_MAX_PACKET_SIZE",
        "-54": "IOTC_ER_SERVER_NOT_SUPPORT",
        "-55": "IOTC_ER_NO_PATH_TO_WRITE_DATA",
        "-56": "IOTC_ER_SERVICE_IS_NOT_STARTED",
        "-57": "IOTC_ER_STILL_IN_PROCESSING",
        "-58": "IOTC_ER_NOT_ENOUGH_MEMORY",
        "-59": "IOTC_ER_DEVICE_IS_BANNED",
        "-60": "IOTC_ER_MASTER_NOT_RESPONSE",
        "-61": "IOTC_ER_RESOURCE_ERROR",
        "-62": "IOTC_ER_QUEUE_FULL",
        "-63": "IOTC_ER_NOT_SUPPORT",
        "-64": "IOTC_ER_DEVICE_IS_SLEEP",
        "-65": "IOTC_ER_TCP_NOT_SUPPORT",
        "-66": "IOTC_ER_WAKEUP_NOT_INITIALIZED",
        "-67": "IOTC_ER_DEVICE_REJECT_BYPORT",
        "-68": "IOTC_ER_DEVICE_REJECT_BY_WRONG_AUTH_KEY",
        "-69": "IOTC_ER_DEVICE_NOT_USE_KEY_AUTHENTICATION",
        "-70": "IOTC_ER_DID_NOT_LOGIN",
        "-71": "IOTC_ER_DID_NOT_LOGIN_WITH_AUTHKEY",
        "-72": "IOTC_ER_SESSION_IN_USE",
        "-90": "IOTC_ER_DEVICE_OFFLINE",
        "-91": "IOTC_ER_MASTER_INVALID",
        "-1001": "TUTK_ER_ALREADY_INITIALIZED",
        "-1002": "TUTK_ER_INVALID_ARG",
        "-1003": "TUTK_ER_MEM_INSUFFICIENT",
        "-1004": "TUTK_ER_INVALID_LICENSE_KEY",
        "-1005": "TUTK_ER_NO_LICENSE_KEY",
        "-10000": "RDT_ER_NOT_INITIALIZED",
        "-10001": "RDT_ER_ALREADY_INITIALIZED",
        "-10002": "RDT_ER_EXCEED_MAX_CHANNEL",
        "-10003": "RDT_ER_MEM_INSUFF",
        "-10004": "RDT_ER_FAIL_CREATE_THREAD",
        "-10005": "RDT_ER_FAIL_CREATE_MUTEX",
        "-10006": "RDT_ER_RDT_DESTROYED",
        "-10007": "RDT_ER_TIMEOUT",
        "-10008": "RDT_ER_INVALID_RDT_ID",
        "-10009": "RDT_ER_RCV_DATA_END",
        "-10010": "RDT_ER_REMOTE_ABORT",
        "-10011": "RDT_ER_LOCAL_ABORT",
        "-10012": "RDT_ER_CHANNEL_OCCUPIED",
        "-10013": "RDT_ER_NO_PERMISSION",
        "-10014": "RDT_ER_INVALID_ARG",
        "-10015": "RDT_ER_LOCAL_EXIT",
        "-10016": "RDT_ER_REMOTE_EXIT",
        "-10017": "RDT_ER_SEND_BUFFER_FULL",
        "-10018": "RDT_ER_UNCLOSED_CONNECTION_DETECTED",
        "-10019": "RDT_ER_DEINITIALIZING",
        "-10020": "RDT_ER_FAIL_INITIALIZE_DTLS",
        "-10021": "RDT_ER_CREATE_DTLS_FAIL",
        "-10022": "RDT_ER_OPERATION_IS_INVALID",
        "-10023": "RDT_ER_REMOTE_NOT_SUPPORT_DTLS",
        "-10024": "RDT_ER_LOCAL_NOT_SUPPORT_DTLS",
        "-20000": "AV_ER_INVALID_ARG",
        "-20001": "AV_ER_BUFPARA_MAXSIZE_INSUFF",
        "-20002": "AV_ER_EXCEED_MAX_CHANNEL",
        "-20003": "AV_ER_MEM_INSUFF",
        "-20004": "AV_ER_FAIL_CREATE_THREAD",
        "-20005": "AV_ER_EXCEED_MAX_ALARM",
        "-20006": "AV_ER_EXCEED_MAX_SIZE",
        "-20007": "AV_ER_SERV_NO_RESPONSE",
        "-20008": "AV_ER_CLIENT_NO_AVLOGIN",
        "-20009": "AV_ER_WRONG_VIEWACCorPWD",
        "-20010": "AV_ER_INVALID_SID",
        "-20011": "AV_ER_TIMEOUT",
        "-20012": "AV_ER_DATA_NOREADY",
        "-20013": "AV_ER_INCOMPLETE_FRAME",
        "-20014": "AV_ER_LOSED_THIS_FRAME",
        "-20015": "AV_ER_SESSION_CLOSE_BY_REMOTE",
        "-20016": "AV_ER_REMOTE_TIMEOUT_DISCONNECT",
        "-20017": "AV_ER_SERVER_EXIT",
        "-20018": "AV_ER_CLIENT_EXIT",
        "-20019": "AV_ER_NOT_INITIALIZED",
        "-20020": "AV_ER_CLIENT_NOT_SUPPORT",
        "-20021": "AV_ER_SENDIOCTRL_ALREADY_CALLED",
        "-20022": "AV_ER_SENDIOCTRL_EXIT",
        "-20023": "AV_ER_NO_PERMISSION",
        "-20024": "AV_ER_WRONG_ACCPWD_LENGTH",
        "-20025": "AV_ER_IOTC_SESSION_CLOSED",
        "-20026": "AV_ER_IOTC_DEINITIALIZED",
        "-20027": "AV_ER_IOTC_CHANNEL_IN_USED",
        "-20028": "AV_ER_WAIT_KEY_FRAME",
        "-20029": "AV_ER_CLEANBUF_ALREADY_CALLED",
        "-20030": "AV_ER_SOCKET_QUEUE_FULL",
        "-20031": "AV_ER_ALREADY_INITIALIZED",
        "-20032": "AV_ER_DASA_CLEAN_BUFFER",
        "-20033": "AV_ER_NOT_SUPPORT",
        "-20034": "AV_ER_FAIL_INITIALIZE_DTLS",
        "-20035": "AV_ER_FAIL_CREATE_DTLS",
        "-20036": "AV_ER_REQUEST_ALREADY_CALLED",
        "-20037": "AV_ER_REMOTE_NOT_SUPPORT",
        "-20038": "AV_ER_TOKEN_EXCEED_MAX_SIZE",
        "-20039": "AV_ER_REMOTE_NOT_SUPPORT_DTLS",
        "-20040": "AV_ER_DTLS_WRONG_PWD",
        "-20041": "AV_ER_DTLS_AUTH_FAIL",
        "-20042": "AV_ER_VSAAS_PULLING_NOT_ENABLE",
        "-20043": "AV_ER_FAIL_CONNECT_TO_VSAAS",
        "-20044": "AV_ER_PARSE_JSON_FAIL",
        "-20045": "AV_ER_PUSH_NOTIFICATION_NOT_ENABLE",
        "-20046": "AV_ER_PUSH_NOTIFICATION_ALREADY_ENABLED",
        "-20047": "AV_ER_NO_NOTIFICATION_LIST",
        "-20048": "AV_ER_HTTP_ERROR",
        "-20049": "AV_ER_LOCAL_NOT_SUPPORT_DTLS",
        "-21334": "AV_ER_SDK_NOT_SUPPORT_DTLS",
        "-30000": "TUNNEL_ER_NOT_INITIALIZED",
        "-30001": "TUNNEL_ER_EXCEED_MAX_SERVICE",
        "-30002": "TUNNEL_ER_BIND_LOCAL_SERVICE",
        "-30003": "TUNNEL_ER_LISTEN_LOCAL_SERVICE",
        "-30004": "TUNNEL_ER_FAIL_CREATE_THREAD",
        "-30005": "TUNNEL_ER_ALREADY_CONNECTED",
        "-30006": "TUNNEL_ER_DISCONNECTED",
        "-30007": "TUNNEL_ER_ALREADY_INITIALIZED",
        "-30008": "TUNNEL_ER_AUTH_FAILED",
        "-30009": "TUNNEL_ER_EXCEED_MAX_LEN",
        "-30010": "TUNNEL_ER_INVALID_SID",
        "-30011": "TUNNEL_ER_UID_UNLICENSE",
        "-30012": "TUNNEL_ER_UID_NO_PERMISSION",
        "-30013": "TUNNEL_ER_UID_NOT_SUPPORT_RELAY",
        "-30014": "TUNNEL_ER_DEVICE_NOT_ONLINE",
        "-30015": "TUNNEL_ER_DEVICE_NOT_LISTENING",
        "-30016": "TUNNEL_ER_NETWORK_UNREACHABLE",
        "-30017": "TUNNEL_ER_FAILED_SETUP_CONNECTION",
        "-30018": "TUNNEL_ER_LOGIN_FAILED",
        "-30019": "TUNNEL_ER_EXCEED_MAX_SESSION",
        "-30020": "TUNNEL_ER_AGENT_NOT_SUPPORT",
        "-30021": "TUNNEL_ER_INVALID_ARG",
        "-30022": "TUNNEL_ER_OS_RESOURCE_LACK",
        "-30023": "TUNNEL_ER_AGENT_NOT_CONNECTING",
        "-30024": "TUNNEL_ER_NO_FREE_SESSION",
        "-30025": "TUNNEL_ER_CONNECTION_CANCELLED",
        "-30026": "TUNNEL_ER_OPERATION_IS_INVALID",
        "-30027": "TUNNEL_ER_HANDSHAKE_FAILED",
        "-30028": "TUNNEL_ER_REMOTE_NOT_SUPPORT_DTLS",
        "-30029": "TUNNEL_ER_LOCAL_NOT_SUPPORT_DTLS",
        "-30030": "TUNNEL_ER_TIMEOUT",
        "-31000": "TUNNEL_ER_UNDEFINED",
    };

    constructor(code, data = null) {
        super(code);
        this.code = code;
        this.data = data;
    }

    get name() {
        return TutkError.name_mapping[this.code] || this.code;
    }

    toString() {
        return this.name;
    }
}

class FormattedStructure {
    toString() {
        const fields = this._fields_
            .map((field) => `${field[0]}: ${this[field[0]]}`)
            .join("\n\t");
        return `${this.constructor.name}:\n\t${fields}`;
    }
}

class SInfoStructEx extends FormattedStructure {
    _fields_ = [
        ["size", "uint32"],
        ["mode", "uint8"],
        ["c_or_d", "int8"],
        ["uid", "char", 21],
        ["remote_ip", "char", 47],
        ["remote_port", "uint16"],
        ["tx_packet_count", "uint32"],
        ["rx_packet_count", "uint32"],
        ["iotc_version", "uint32"],
        ["vendor_id", "uint16"],
        ["product_id", "uint16"],
        ["group_id", "uint16"],
        ["is_secure", "uint8"],
        ["local_nat_type", "uint8"],
        ["remote_nat_type", "uint8"],
        ["relay_type", "uint8"],
        ["net_state", "uint32"],
        ["remote_wan_ip", "char", 47],
        ["remote_wan_port", "uint16"],
        ["is_nebula", "uint8"],
    ];
}

class FrameInfoStruct extends FormattedStructure {
    _fields_ = [
        ["codec_id", "uint16"],
        ["is_keyframe", "uint8"],
        ["cam_index", "uint8"],
        ["online_num", "uint8"],
        ["framerate", "uint8"],
        ["frame_size", "uint8"],
        ["bitrate", "uint8"],
        ["timestamp_ms", "uint32"],
        ["timestamp", "uint32"],
        ["frame_len", "uint32"],
        ["frame_no", "uint32"],
        ["ac_mac_addr", "char", 12],
        ["n_play_token", "int32"],
    ];
}

class FrameInfo3Struct extends FormattedStructure {
    _fields_ = [
        ["codec_id", "uint16"],
        ["is_keyframe", "uint8"],
        ["cam_index", "uint8"],
        ["online_num", "uint8"],
        ["framerate", "uint8"],
        ["frame_size", "uint8"],
        ["bitrate", "uint8"],
        ["timestamp_ms", "uint32"],
        ["timestamp", "uint32"],
        ["frame_len", "uint32"],
        ["frame_no", "uint32"],
        ["ac_mac_addr", "char", 12],
        ["n_play_token", "int32"],
        ["face_pos_x", "uint16"],
        ["face_pos_y", "uint16"],
        ["face_width", "uint16"],
        ["face_height", "uint16"],
    ];
}

class St_IOTCCheckDeviceInput extends FormattedStructure {
    _fields_ = [
        ["cb", "uint32"],
        ["auth_type", "uint32"],
        ["auth_key", "char", 8],
    ];
}

class St_IOTCCheckDeviceOutput extends FormattedStructure {
    _fields_ = [
        ["status", "uint32"],
        ["last_login", "uint32"],
    ];
}

class St_IOTCConnectInput extends FormattedStructure {
    _fields_ = [
        ["cb", "uint32"],
        ["auth_type", "uint32"],
        ["auth_key", "char", 8],
        ["timeout", "uint32"],
    ];
}

class LogAttr extends FormattedStructure {
    _fields_ = [
        ["path", "char_p"],
        ["log_level", "uint32"],
        ["file_max_size", "int32"],
        ["file_max_count", "int32"],
    ];
}

class AVClientStartInConfig extends FormattedStructure {
    _fields_ = [
        ["cb", "uint32"],
        ["iotc_session_id", "uint32"],
        ["iotc_channel_id", "uint8"],
        ["timeout_sec", "uint32"],
        ["account_or_identity", "char_p"],
        ["password_or_token", "char_p"],
        ["resend", "int32"],
        ["security_mode", "uint32"],
        ["auth_type", "uint32"],
        ["sync_recv_data", "int32"],
    ];
}

class AVClientStartOutConfig extends FormattedStructure {
    _fields_ = [
        ["cb", "uint32"],
        ["server_type", "uint32"],
        ["resend", "int32"],
        ["two_way_streaming", "int32"],
        ["sync_recv_data", "int32"],
        ["security_mode", "uint32"],
    ];
}

function av_recv_frame_data(tutk_platform_lib, av_chan_id) {
    const frame_data_max_len = 800000;
    const frame_data_actual_len = new Int32Array(1);
    const frame_data_expected_len = new Int32Array(1);
    const frame_data = Buffer.alloc(frame_data_max_len);
    const frame_info_actual_len = new Int32Array(1);
    const frame_index = new Uint32Array(1);
    const frame_info_max_len = 4096;
    const frame_info = Buffer.alloc(frame_info_max_len);
    const errno = tutk_platform_lib.avRecvFrameData2(
        av_chan_id,
        frame_data,
        frame_data_max_len,
        frame_data_actual_len,
        frame_data_expected_len,
        frame_info,
        frame_info_max_len,
        frame_info_actual_len,
        frame_index
    );
    if (errno < 0) {
        return [errno, null, null, null];
    }
    const frame_data_actual = frame_data.slice(0, frame_data_actual_len[0]);
    let frame_info_actual;
    if (frame_info_actual_len[0] === FrameInfo3Struct.size) {
        frame_info_actual = FrameInfo3Struct.fromBuffer(frame_info);
    } else if (frame_info_actual_len[0] === FrameInfoStruct.size) {
        frame_info_actual = FrameInfoStruct.fromBuffer(frame_info);
    } else {
        throw new Error(
            `Unknown frame info structure format! len=${frame_info_actual_len}`
        );
    }
    return [0, frame_data_actual, frame_info_actual, frame_index[0]];
}

function av_recv_audio_data(tutk_platform_lib, av_chan_id) {
    const audio_data_max_size = 51200;
    const frame_info_max_size = 1024;
    const audio_data = Buffer.alloc(audio_data_max_size);
    const frame_info_buffer = Buffer.alloc(frame_info_max_size);
    const frame_index = new Uint32Array(1);
    const frame_len = tutk_platform_lib.avRecvAudioData(
        av_chan_id,
        audio_data,
        audio_data_max_size,
        frame_info_buffer,
        frame_info_max_size,
        frame_index
    );
    if (frame_len < 0) {
        return [frame_len, null, null];
    }
    const frame_info = frame_info_buffer.readStruct(FrameInfo3Struct);
    return [0, audio_data.slice(0, frame_len), frame_info];
}

function av_check_audio_buf(tutk_platform_lib, av_chan_id) {
    return tutk_platform_lib.avCheckAudioBuf(av_chan_id);
}

function av_recv_io_ctrl(tutk_platform_lib, av_chan_id, timeout_ms) {
    const pn_io_ctrl_type = new Uint32Array(1);
    const ctl_data_len = 1024 * 1024;
    const ctl_data = Buffer.alloc(ctl_data_len);
    const actual_len = tutk_platform_lib.avRecvIOCtrl(
        av_chan_id,
        pn_io_ctrl_type,
        ctl_data,
        ctl_data_len,
        timeout_ms
    );
    return [
        actual_len,
        pn_io_ctrl_type[0],
        actual_len > 0 ? ctl_data.slice(0, actual_len) : null,
    ];
}

function av_client_set_max_buf_size(tutk_platform_lib, size) {
    tutk_platform_lib.avClientSetMaxBufSize(size);
}

function av_client_set_recv_buf_size(tutk_platform_lib, channel_id, size) {
    tutk_platform_lib.avClientSetRecvBufMaxSize(channel_id, size);
}

function av_client_clean_buf(tutk_platform_lib, channel_id) {
    tutk_platform_lib.avClientCleanBuf(channel_id);
}

function av_client_clean_local_buf(tutk_platform_lib, channel_id) {
    tutk_platform_lib.avClientCleanLocalBuf(channel_id);
}

function av_client_clean_local_video_buf(tutk_platform_lib, channel_id) {
    tutk_platform_lib.avClientCleanLocalVideoBuf(channel_id);
}

function av_client_clean_local_audio_buf(tutk_platform_lib, channel_id) {
    tutk_platform_lib.avClientCleanAudioBuf(channel_id);
}

function av_client_stop(tutk_platform_lib, av_chan_id) {
    tutk_platform_lib.avClientStop(av_chan_id);
}

function av_send_io_ctrl(tutk_platform_lib, av_chan_id, ctrl_type, data) {
    const length = data ? data.length : 0;
    const cdata = data ? Buffer.from(data) : null;
    return tutk_platform_lib.avSendIOCtrl(av_chan_id, ctrl_type, cdata, length);
}

function iotc_session_close(tutk_platform_lib, session_id) {
    tutk_platform_lib.IOTC_Session_Close(session_id);
}

function av_client_start(
    tutk_platform_lib,
    session_id,
    username,
    password,
    timeout_secs,
    channel_id,
    resend
) {
    const avc_in = new AVClientStartInConfig();
    avc_in.cb = AVClientStartInConfig.size;
    avc_in.iotc_session_id = session_id;
    avc_in.iotc_channel_id = channel_id;
    avc_in.timeout_sec = timeout_secs;
    avc_in.account_or_identity = username;
    avc_in.password_or_token = password;
    avc_in.resend = resend;
    avc_in.security_mode = 2;
    const avc_out = new AVClientStartOutConfig();
    avc_out.cb = AVClientStartOutConfig.size;
    return tutk_platform_lib.avClientStartEx(avc_in, avc_out);
}

function av_initialize(tutk_platform_lib, max_num_channels = 1) {
    const max_chans = tutk_platform_lib.avInitialize(max_num_channels);
    return max_chans;
}

function av_deinitialize(tutk_platform_lib) {
    const errno = tutk_platform_lib.avDeInitialize();
    return errno;
}

function iotc_session_check(tutk_platform_lib, session_id) {
    const sess_info = new SInfoStructEx();
    sess_info.size = SInfoStructEx.size;
    const err_code = tutk_platform_lib.IOTC_Session_Check_Ex(session_id, sess_info);
    return [err_code, sess_info];
}

function iotc_connect_by_uid(tutk_platform_lib, p2p_id) {
    const session_id = tutk_platform_lib.IOTC_Connect_ByUID(p2p_id);
    return session_id;
}

function iotc_get_session_id(tutk_platform_lib) {
    const session_id = tutk_platform_lib.IOTC_Get_SessionID();
    return session_id;
}


function iotcCheckDeviceOnline(tutkPlatformLib, p2pId, authKey, timeoutMs = 5000) {
    let deviceIn = new St_IOTCCheckDeviceInput();
    deviceIn.cb = sizeof(deviceIn);
    deviceIn.authKey = authKey;
    let deviceOut = new St_IOTCCheckDeviceOutput();
    let status = tutkPlatformLib.IOTC_Check_Device_OnlineEx(
        p2pId.encode("ascii"),
        deviceIn.ref(),
        deviceOut.ref(),
        timeoutMs,
        0
    );
    return [status, deviceOut];
}

function iotcConnectByUidParallel(tutkPlatformLib, p2pId, sessionId) {
    let resultantSessionId = tutkPlatformLib.IOTC_Connect_ByUID_Parallel(
        p2pId.encode("ascii"), sessionId
    );
    return resultantSessionId;
}

function iotcConnectByUidEx(tutkPlatformLib, p2pId, sessionId, authKey, timeout = 20) {
    let connectInput = new St_IOTCConnectInput();
    connectInput.cb = sizeof(connectInput);
    connectInput.authKey = authKey;
    connectInput.timeout = timeout;
    let resultantSessionId = tutkPlatformLib.IOTC_Connect_ByUIDEx(
        p2pId.encode("ascii"), sessionId, connectInput.ref()
    );
    return resultantSessionId;
}

function iotcConnectStopBySessionId(tutkPlatformLib, sessionId) {
    let errno = tutkPlatformLib.IOTC_Connect_Stop_BySID(sessionId);
    return errno;
}

function iotcSetLogPath(tutkPlatformLib, path) {
    tutkPlatformLib.IOTC_Set_Log_Path(path.encode("ascii"), 0);
}

function iotcSetLogAttr(tutkPlatformLib, path, logLevel = 0, maxSize = 0, maxCount = 0) {
    let logAttr = new LogAttr();
    logAttr.path = path.encode("ascii");
    logAttr.logLevel = logLevel;
    logAttr.fileMaxSize = maxSize;
    logAttr.fileMaxCount = maxCount;
    let errno = tutkPlatformLib.IOTC_Set_Log_Attr(logAttr.ref());
    return errno;
}

function iotcGetVersion(tutkPlatformLib) {
    return tutkPlatformLib.IOTC_Get_Version_String();
}

function iotcInitialize(tutkPlatformLib, udpPort = 0) {
    let errno = tutkPlatformLib.IOTC_Initialize2(udpPort);
    return errno;
}

function tutkSdkSetLicenseKey(tutkPlatformLib, key) {
    let errno = tutkPlatformLib.TUTK_SDK_Set_License_Key(key.encode("ascii"));
    return errno;
}

function iotcDeinitialize(tutkPlatformLib) {
    let errno = tutkPlatformLib.IOTC_DeInitialize();
    return errno;
}

function loadLibrary(sharedLibPath = null) {
    if (!sharedLibPath) {
        sharedLibPath = "/usr/local/lib/libIOTCAPIs_ALL.so";
    }
    return require('ffi').Library(sharedLibPath, {/* function definitions */});
}