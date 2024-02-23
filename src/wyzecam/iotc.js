import { WyzeAccount, WyzeCamera } from 'wyzecam/api_models';
import { TutkIOCtrlMux } from 'wyzecam/tutk/tutk_ioctl_mux';
import { K10000ConnectRequest, K10052DBSetResolvingBit, K10056SetResolvingBit, respond_to_ioctrl_10001 } from 'wyzecam/tutk/tutk_protocol';
import { CDLL, c_int } from 'ctypes';
import { EEXIST, EPIPE } from 'errno';
import { F_GETFL, F_SETFL, fcntl } from 'fcntl';
import { Any, Iterator, Optional, Union } from 'typing';
import { TutkError } from 'wyzecam/tutk';
import { Tutk } from 'wyzecam/tutk';
import { SInfoStructEx } from 'wyzecam/tutk';
import { FrameInfo3Struct } from 'wyzecam/tutk';
import { FrameInfoStruct } from 'wyzecam/tutk';
import { av } from 'av';
import { VideoFrame } from 'av.video.frame';
import { cv2 } from 'cv2';
import { numpy as np } from 'numpy';
import { base64 } from 'base64';
import { contextlib } from 'contextlib';
import { enum } from 'enum';
import { hashlib } from 'hashlib';
import { io } from 'io';
import { logging } from 'logging';
import { os } from 'os';
import { pathlib } from 'pathlib';
import { time } from 'time';
import { warnings } from 'warnings';

const logger = logging.getLogger(__name__);

class WyzeIOTC {
    tutk_platform_lib: CDLL;
    initd: boolean;
    udp_port: number;
    max_num_av_channels: number;
    sdk_key: string;
    debug: boolean;

    constructor(
        tutk_platform_lib: Optional<Union<string, CDLL>> = null,
        udp_port: Optional<number> = null,
        max_num_av_channels: Optional<number> = 1,
        sdk_key: Optional<string> = null,
        debug: boolean = false
    ) {
        if (tutk_platform_lib === null) {
            tutk_platform_lib = tutk.load_library();
        }
        if (typeof tutk_platform_lib === 'string') {
            const path = pathlib.Path(tutk_platform_lib);
            tutk_platform_lib = tutk.load_library(str(path.absolute()));
        }
        if (!sdk_key) {
            sdk_key = os.getenv("SDK_KEY");
        }
        const license_status = tutk.TUTK_SDK_Set_License_Key(tutk_platform_lib, sdk_key);
        if (license_status < 0) {
            throw new tutk.TutkError(license_status);
        }
        const set_region = tutk_platform_lib.TUTK_SDK_Set_Region(3);  // REGION_US
        if (set_region < 0) {
            throw new tutk.TutkError(set_region);
        }
        this.tutk_platform_lib = tutk_platform_lib;
        this.initd = false;
        this.udp_port = udp_port || 0;
        this.max_num_av_channels = max_num_av_channels;
        if (debug) {
            logging.basicConfig();
            logger.setLevel(logging.DEBUG);
            tutk_protocol.logger.setLevel(logging.DEBUG);
            tutk_ioctl_mux.logger.setLevel(logging.DEBUG);
        }
    }

    initialize() {
        if (this.initd) {
            return;
        }
        this.initd = true;
        const err_no = tutk.iotc_initialize(this.tutk_platform_lib, udp_port=this.udp_port);
        if (err_no < 0) {
            throw new tutk.TutkError(err_no);
        }
        const actual_num_chans = tutk.av_initialize(
            this.tutk_platform_lib, max_num_channels=this.max_num_av_channels
        );
        if (actual_num_chans < 0) {
            throw new tutk.TutkError(err_no);
        }
        this.max_num_av_channels = actual_num_chans;
    }

    deinitialize() {
        tutk.av_deinitialize(this.tutk_platform_lib);
        tutk.iotc_deinitialize(this.tutk_platform_lib);
    }

    get version() {
        return tutk.iotc_get_version(this.tutk_platform_lib);
    }

    __enter__() {
        this.initialize();
        return this;
    }

    __exit__(exc_type, exc_val, exc_tb) {
        this.deinitialize();
    }

    session(stream, state) {
        if (stream.options.substream) {
            stream.user.phone_id = stream.user.phone_id[2:];
        }
        return new WyzeIOTCSession(
            this.tutk_platform_lib,
            stream.user,
            stream.camera,
            frame_size=stream.options.frame_size,
            bitrate=stream.options.bitrate,
            enable_audio=stream.options.audio,
            stream_state=state,
            substream=stream.options.substream,
        );
    }

    connect_and_auth(account, camera) {
        return new WyzeIOTCSession(this.tutk_platform_lib, account, camera);
    }
}

class WyzeIOTCSessionState extends enum.IntEnum {
    DISCONNECTED = 0;
    IOTC_CONNECTING = 1;
    AV_CONNECTING = 2;
    CONNECTED = 3;
    CONNECTING_FAILED = 4;
    AUTHENTICATING = 5;
    AUTHENTICATION_SUCCEEDED = 6;
    AUTHENTICATION_FAILED = 7;
}

const FRAME_SIZE = {0: "HD", 1: "SD", 3: "2K"};

class WyzeIOTCSession {
    tutk_platform_lib: CDLL;
    account: WyzeAccount;
    camera: WyzeCamera;
    session_id: Optional<c_int>;
    av_chan_id: Optional<c_int>;
    state: WyzeIOTCSessionState;
    preferred_frame_rate: number;
    preferred_frame_size: number;
    preferred_bitrate: number;
    connect_timeout: number;
    enable_audio: boolean;
    stream_state: c_int;
    audio_pipe_ready: boolean;
    frame_ts: number;
    substream: boolean;

    constructor(
        tutk_platform_lib: CDLL,
        account: WyzeAccount,
        camera: WyzeCamera,
        frame_size: number = tutk.FRAME_SIZE_1080P,
        bitrate: number = tutk.BITRATE_HD,
        enable_audio: boolean = true,
        connect_timeout: number = 20,
        stream_state: c_int = c_int(0),
        substream: boolean = false
    ) {
        this.tutk_platform_lib = tutk_platform_lib;
        this.account = account;
        this.camera = camera;
        this.session_id = null;
        this.av_chan_id = null;
        this.state = WyzeIOTCSessionState.DISCONNECTED;
        this.preferred_frame_rate = 15;
        this.preferred_frame_size = frame_size;
        this.preferred_bitrate = bitrate;
        this.connect_timeout = connect_timeout;
        this.enable_audio = enable_audio;
        this.stream_state = stream_state;
        this.audio_pipe_ready = false;
        this.frame_ts = 0.0;
        this.substream = substream;
    }

    get resolution() {
        return FRAME_SIZE.get(this.preferred_frame_size, str(this.preferred_frame_size));
    }

    get sleep_interval() {
        if (os.getenv("LOW_LATENCY")) {
            return 0;
        }
        if (!this.frame_ts) {
            return 0.01;
        }
        const delta = Math.max(time.time() - this.frame_ts, 0.0);
        return Math.max((1 / this.preferred_frame_rate) - delta, 0.01);
    }

    get pipe_name() {
        return this.camera.name_uri + ("-sub" if this.substream else "");
    }

    session_check() {
        assert (
            this.session_id !== null
        ), "Please call _connect() before session_check()";
        const [errcode, sess_info] = tutk.iotc_session_check(
            this.tutk_platform_lib, this.session_id
        );
        if (errcode < 0) {
            throw new tutk.TutkError(errcode);
        }
        return sess_info;
    }

    iotctrl_mux() {
        assert this.av_chan_id !== null, "Please call _connect() first!";
        return new TutkIOCtrlMux(this.tutk_platform_lib, this.av_chan_id);
    }

    __enter__() {
        this._connect();
        this._auth();
        return this;
    }

    __exit__(exc_type, exc_val, exc_tb) {
        this._disconnect();
    }

    check_native_rtsp(start_rtsp = false) {
        if (!this.camera.rtsp_fw) {
            return;
        }
        with (this.iotctrl_mux()) {
            try {
                const resp = mux.send_ioctl(tutk_protocol.K10604GetRtspParam()).result(
                    timeout=5
                );
            } catch (Exception) {
                logger.warning("RTSP Check Failed.");
                return;
            }
        }
        if (!resp) {
            logger.info("Could not determine if RTSP is supported.");
            return;
        }
        logger.debug(f"RTSP={resp}");
        if (!resp[0]) {
            logger.info("RTSP disabled in the app.");
            if (!start_rtsp) {
                return;
            }
            try {
                with (this.iotctrl_mux()) {
                    mux.send_ioctl(tutk_protocol.K10600SetRtspSwitch()).result(
                        timeout=5
                    );
                }
            } catch (Exception) {
                logger.warning("Can't start RTSP server on camera.");
                return;
            }
        }
        if (len(decoded_url := resp.decode().split("rtsp:"))) {
            return f"rtsp:";
        }
    }

    recv_bridge_data() {
        assert this.av_chan_id !== null, "Please call _connect() first!";
        this.sync_camera_time();
        let have_key_frame = false;
        while (this.should_stream(sleep=this.sleep_interval)) {
            if (!this._received_first_frame(have_key_frame)) {
                have_key_frame = true;
                continue;
            }
            const [err_no, frame_data, frame_info, _] = tutk.av_recv_frame_data(
                this.tutk_platform_lib, this.av_chan_id
            );
            if (!frame_data || err_no < 0) {
                this._handle_frame_error(err_no);
                continue;
            }
            assert frame_info !== null, "Empty frame_info without an error!";
            if (this._invalid_frame_size(frame_info, have_key_frame)) {
                have_key_frame = false;
                continue;
            }
            if (this._video_frame_slow(frame_info) && have_key_frame) {
                continue;
            }
            if (frame_info.is_keyframe) {
                have_key_frame = true;
            }
            yield frame_data;
        }
        this.state = WyzeIOTCSessionState.CONNECTING_FAILED;
        return b"";
    }

    _received_first_frame(have_key_frame) {
        const delta = time.time() - this.frame_ts;
        if (delta < this.connect_timeout) {
            return true;
        }
        if (have_key_frame) {
            this.state = WyzeIOTCSessionState.CONNECTING_FAILED;
            throw new Exception(`Did not receive a frame for ${int(delta)}s`);
        }
        warnings.warn("Still waiting for first frame. Updating frame size.");
        this.update_frame_size_rate();
        return false;
    }

    _invalid_frame_size(frame_info, have_key_frame) {
        if (frame_info.frame_size in this.valid_frame_size()) {
            return false;
        }
        this.flush_pipe("audio");
        if (!have_key_frame) {
            warnings.warn(
                `Skipping wrong frame_size at start of stream [frame_size=${frame_info.frame_size}]`
            );
            return true;
        }
        warnings.warn(`Wrong (${frame_info.frame_size=})`);
        this.update_frame_size_rate();
        return true;
    }

    _video_frame_slow(frame_info) {
        if (!this.enable_audio || frame_info.timestamp < 1591069888) {
            this.frame_ts = time.time();
            return;
        }
        const frame_ts = parseFloat(`${frame_info.timestamp}.${frame_info.timestamp_ms}`);
        const gap = time.time() - frame_ts;
        if (!frame_info.is_keyframe && gap > 10) {
            logger.warning("[video] super slow");
            this.clear_buffer();
        }
        if (!frame_info.is_keyframe && gap >= 0.5) {
            logger.debug(`[video] slow ${gap=}`);
            this.flush_pipe("audio");
            return true;
        }
        this.frame_ts = frame_ts;
    }

    _handle_frame_error(err_no) {
        time.sleep(0.05);
        if (err_no == tutk.AV_ER_DATA_NOREADY || err_no >= 0) {
            return;
        }
        if (err_no in {tutk.AV_ER_INCOMPLETE_FRAME, tutk.AV_ER_LOSED_THIS_FRAME}) {
            warnings.warn(tutk.TutkError(err_no).name);
        }
        throw new tutk.TutkError(err_no);
    }

    should_stream(sleep = 0.01) {
        time.sleep(sleep);
        return (
            this.state == WyzeIOTCSessionState.AUTHENTICATION_SUCCEEDED
            && this.stream_state.value > 1
        );
    }

    valid_frame_size() {
        const alt = this.preferred_frame_size + (1 if this.preferred_frame_size == 3 else 3);
        return {this.preferred_frame_size, int(os.getenv("IGNORE_RES", alt))};
    }

    sync_camera_time() {
        with (this.iotctrl_mux()) {
            with (contextlib.suppress(tutk_ioctl_mux.Empty)) {
                mux.send_ioctl(tutk_protocol.K10092SetCameraTime()).result(False);
            }
        }
        this.frame_ts = time.time();
    }

    update_frame_size_rate(bitrate = null, fps = 0) {
        if (bitrate) {
            this.preferred_bitrate = bitrate;
        }
        const iotc_msg = this.preferred_frame_size, this.preferred_bitrate, fps;
        with (this.iotctrl_mux()) {
            logger.warning(`Requesting frame_size=${iotc_msg[0]}, bitrate=${iotc_msg[1]}, fps=${iotc_msg[2]}`);
            with (contextlib.suppress(tutk_ioctl_mux.Empty)) {
                if (this.camera.product_model in ["WYZEDB3", "WVOD1", "HL_WCO2"]) {
                    mux.send_ioctl(K10052DBSetResolvingBit(...iotc_msg)).result(False);
                } else {
                    mux.send_ioctl(K10056SetResolvingBit(...iotc_msg)).result(False);
                }
            }
        }
    }

    clear_buffer() {
        warnings.warn("clear buffer");
        this.sync_camera_time();
        tutk.av_client_clean_buf(this.tutk_platform_lib, this.av_chan_id);
    }

    flush_pipe(pipe_type = "audio") {
        if (pipe_type == "audio" && !this.audio_pipe_ready) {
            return;
        }
        const fifo = `/tmp/${this.pipe_name}_${pipe_type}.pipe`;
        logger.info(`flushing ${pipe_type}`);
        try {
            with (io.open(fifo, "rb", buffering=8192)) {
                const flags = fcntl(pipe.fileno(), F_GETFL);
                fcntl(pipe.fileno(), F_SETFL, flags | os.O_NONBLOCK);
                pipe.read(8192);
            }
            if (pipe_type == "audio") {
                this.audio_pipe_ready = false;
            }
        } catch (Exception as e) {
            logger.warning(`Flushing Error: ${e}`);
        }
    }

    recv_audio_data() {
        assert this.av_chan_id !== null, "Please call _connect() first!";
        try {
            while (this.should_stream()) {
                const [err_no, frame_data, frame_info] = tutk.av_recv_audio_data(
                    this.tutk_platform_lib, this.av_chan_id
                );
                if (!frame_data || err_no < 0) {
                    this._handle_frame_error(err_no);
                    continue;
                }
                assert frame_info !== null, "Empty frame_info without an error!";
                if (this._audio_frame_slow(frame_info)) {
                    continue;
                }
                yield frame_data, frame_info;
            }
        } catch (tutk.TutkError as ex) {
            warnings.warn(ex.name);
        } finally {
            this.state = WyzeIOTCSessionState.CONNECTING_FAILED;
        }
    }

    recv_audio_pipe() {
        const fifo_path = `/tmp/${this.pipe_name}_audio.pipe`;
        try {
            os.mkfifo(fifo_path, os.O_NONBLOCK);
        } catch (OSError as e) {
            if (e.errno != EEXIST) {
                throw e;
            }
        }
        try {
            with (open(fifo_path, "wb")) {
                for (const [frame_data, _] of this.recv_audio_data()) {
                    audio_pipe.write(frame_data);
                    this.audio_pipe_ready = true;
                }
            }
        } catch (IOError as ex) {
            if (ex.errno != EPIPE) {
                warnings.warn(str(ex));
            }
        } finally {
            this.audio_pipe_ready = false;
            os.unlink(fifo_path);
            warnings.warn("Audio pipe closed");
        }
    }

    get_audio_sample_rate() {
        if (this.camera.camera_info && "audioParm" in this.camera.camera_info) {
            const audio_param = this.camera.camera_info["audioParm"];
            return parseInt(audio_param.get("sampleRate", this.camera.default_sample_rate));
        }
        return this.camera.default_sample_rate;
    }

    get_audio_codec_from_codec_id(codec_id) {
        const sample_rate = this.get_audio_sample_rate();
        const codec_mapping = {
            137: ["mulaw", sample_rate],
            140: ["s16le", sample_rate],
            141: ["aac", sample_rate],
            143: ["alaw", sample_rate],
            144: ["aac_eld", 16000],
            146: ["opus", 16000],
        };
        const [codec, sample_rate] = codec_mapping.get(codec_id, [null, null]);
        if (!codec) {
            throw new Exception(`\nUnknown audio codec ${codec_id=}\n`);
        }
        logger.info(`[AUDIO] ${codec=} ${sample_rate=} ${codec_id=}`);
        return [codec, sample_rate];
    }

    identify_audio_codec(limit = 25) {
        assert this.av_chan_id !== null, "Please call _connect() first!";
        for (let _ = 0; _ < limit; _++) {
            const [err_no, _, frame_info] = tutk.av_recv_audio_data(
                this.tutk_platform_lib, this.av_chan_id
            );
            if (!err_no && frame_info && frame_info.codec_id) {
                return this.get_audio_codec_from_codec_id(frame_info.codec_id);
            }
            time.sleep(0.05);
        }
        throw new Exception("Unable to identify audio.");
    }

    recv_video_frame() {
        if (av === null) {
            throw new RuntimeError(
                "recv_video_frame requires PyAv to parse video frames. " +
                "Install with `pip install av` and try again."
            );
        }
        let codec = null;
        for (const [frame_data, frame_info] of this.recv_video_data()) {
            if (codec === null) {
                codec = this._av_codec_from_frameinfo(frame_info);
            }
            const packets = codec.parse(frame_data);
            for (const packet of packets) {
                const frames = codec.decode(packet);
                for (const frame of frames) {
                    yield frame, frame_info;
                }
            }
        }
    }
}


function* recv_video_frame_ndarray_with_stats(stat_window_size = 210, draw_stats = "{width}x{height} {kilobytes_per_second} kB/s {frames_per_second} FPS") {
    let stat_window = [];
    for (let [frame_ndarray, frame_info] of recv_video_frame_ndarray()) {
        stat_window.push(frame_info);
        if (stat_window.length > stat_window_size) {
            stat_window = stat_window.slice(stat_window.length - stat_window_size);
        }
        if (stat_window.length > 1) {
            let stat_window_start = stat_window[0].timestamp + stat_window[0].timestamp_ms / 1_000_000;
            let stat_window_end = stat_window[stat_window.length - 1].timestamp + stat_window[stat_window.length - 1].timestamp_ms / 1_000_000;
            let stat_window_duration = stat_window_end - stat_window_start;
            if (stat_window_duration <= 0) {
                stat_window_duration = stat_window.length / stat_window[stat_window.length - 1].framerate;
            }
            let stat_window_total_size = stat_window.slice(0, -1).reduce((total, b) => total + b.frame_len, 0);
            let bytes_per_second = parseInt(stat_window_total_size / stat_window_duration);
            let frames_per_second = parseInt(stat_window.length / stat_window_duration);
        } else {
            let bytes_per_second = 0;
            let stat_window_duration = 0;
            let frames_per_second = 0;
        }
        let stats = {
            "bytes_per_second": bytes_per_second,
            "kilobytes_per_second": parseInt(bytes_per_second / 1000),
            "window_duration": stat_window_duration,
            "frames_per_second": frames_per_second,
            "width": frame_ndarray.shape[1],
            "height": frame_ndarray.shape[0],
        };
        if (draw_stats) {
            let text = draw_stats.replace("{width}", stats.width).replace("{height}", stats.height).replace("{kilobytes_per_second}", stats.kilobytes_per_second).replace("{frames_per_second}", stats.frames_per_second);
            cv2.putText(frame_ndarray, text, [50, 50], cv2.FONT_HERSHEY_DUPLEX, 1, [0, 0, 0], 2, cv2.LINE_AA);
            cv2.putText(frame_ndarray, text, [50, 50], cv2.FONT_HERSHEY_DUPLEX, 1, [255, 255, 255], 1, cv2.LINE_AA);
        }
        yield [frame_ndarray, frame_info, stats];
    }
}

function _av_codec_from_frameinfo(frame_info) {
    let codec_name;
    if ([75, 78].includes(frame_info.codec_id)) {
        codec_name = "h264";
    } else if (frame_info.codec_id == 80) {
        codec_name = "hevc";
    } else {
        codec_name = "h264";
        console.warn(`Unexpected codec! got ${frame_info.codec_id}.`);
    }
    let codec = av.CodecContext.create(codec_name, "r");
    return codec;
}

function _connect(timeout_secs = 10, channel_id = 0, username = "admin", password = "888888", max_buf_size = 5 * 1024 * 1024) {
    try {
        this.state = WyzeIOTCSessionState.IOTC_CONNECTING;
        let session_id = tutk.iotc_get_session_id(this.tutk_platform_lib);
        if (session_id < 0) {
            throw new tutk.TutkError(session_id);
        }
        this.session_id = session_id;
        if (!this.camera.dtls && !this.camera.parent_dtls) {
            console.debug("Connect via IOTC_Connect_ByUID_Parallel");
            session_id = tutk.iotc_connect_by_uid_parallel(this.tutk_platform_lib, this.camera.p2p_id, this.session_id);
        } else {
            console.debug("Connect via IOTC_Connect_ByUIDEx");
            password = this.camera.enr;
            if (this.camera.parent_dtls) {
                password = this.camera.parent_enr;
            }
            session_id = tutk.iotc_connect_by_uid_ex(this.tutk_platform_lib, this.camera.p2p_id, this.session_id, this.get_auth_key(), this.connect_timeout);
        }
        if (session_id < 0) {
            throw new tutk.TutkError(session_id);
        }
        this.session_id = session_id;
        this.session_check();
        let resend = parseInt(process.env.RESEND || 1);
        if (this.camera.product_model in ["WVOD1", "HL_WCO2"]) {
            resend = 0;
        }
        this.state = WyzeIOTCSessionState.AV_CONNECTING;
        let av_chan_id = tutk.av_client_start(this.tutk_platform_lib, this.session_id, username.encode("ascii"), password.encode("ascii"), timeout_secs, channel_id, resend);
        if (av_chan_id < 0) {
            throw new tutk.TutkError(av_chan_id);
        }
        this.av_chan_id = av_chan_id;
        this.state = WyzeIOTCSessionState.CONNECTED;
    } catch (error) {
        this._disconnect();
        throw error;
    } finally {
        if (this.state != WyzeIOTCSessionState.CONNECTED) {
            this.state = WyzeIOTCSessionState.CONNECTING_FAILED;
        }
    }
    console.info(`AV Client Start: chan_id=${this.av_chan_id} expected_chan=${channel_id}`);
    tutk.av_client_set_recv_buf_size(this.tutk_platform_lib, this.av_chan_id, max_buf_size);
}

function get_auth_key() {
    let auth = this.camera.enr + this.camera.mac.toUpperCase();
    if (this.camera.parent_dtls) {
        auth = this.camera.parent_enr + this.camera.parent_mac.toUpperCase();
    }
    let hashed_enr = hashlib.sha256(auth.encode("utf-8"));
    let bArr = Array.from(hashed_enr.digest()).slice(0, 6);
    return base64.standard_b64encode(bArr).decode().replace("+", "Z").replace("/", "9").replace("=", "A").encode("ascii");
}

function _auth() {
    if (this.state == WyzeIOTCSessionState.CONNECTING_FAILED) {
        return;
    }
    assert(this.state == WyzeIOTCSessionState.CONNECTED, `Auth expected state to be connected but not authed; state=${this.state.name}`);
    this.state = WyzeIOTCSessionState.AUTHENTICATING;
    try {
        with (this.iotctrl_mux()) {
            let wake_mac = null;
            if (["WVOD1", "HL_WCO2"].includes(this.camera.product_model)) {
                wake_mac = this.camera.mac;
            }
            let challenge = mux.send_ioctl(K10000ConnectRequest(wake_mac));
            let challenge_response = respond_to_ioctrl_10001(challenge.result(), challenge.resp_protocol, this.camera.enr + this.camera.parent_enr, this.camera.product_model, this.camera.mac, this.account.phone_id, this.account.open_user_id, this.enable_audio);
            if (!challenge_response) {
                throw new ValueError("AUTH_FAILED");
            }
            let auth_response = mux.send_ioctl(challenge_response).result();
            if (auth_response["connectionRes"] == "2") {
                throw new ValueError("ENR_AUTH_FAILED");
            }
            if (auth_response["connectionRes"] != "1") {
                console.warn(`AUTH FAILED: ${auth_response}`);
                throw new ValueError("AUTH_FAILED");
            }
            this.camera.set_camera_info(auth_response["cameraInfo"]);
            let frame_bit = [this.preferred_frame_size, this.preferred_bitrate];
            let ioctl_msg;
            if (["WYZEDB3", "WVOD1", "HL_WCO2", "WYZEC1"].includes(this.camera.product_model)) {
                ioctl_msg = K10052DBSetResolvingBit(...frame_bit);
            } else {
                ioctl_msg = K10056SetResolvingBit(...frame_bit);
            }
            mux.waitfor(mux.send_ioctl(ioctl_msg));
            this.state = WyzeIOTCSessionState.AUTHENTICATION_SUCCEEDED;
        }
    } catch (error) {
        this._disconnect();
        throw error;
    } finally {
        if (this.state != WyzeIOTCSessionState.AUTHENTICATION_SUCCEEDED) {
            this.state = WyzeIOTCSessionState.AUTHENTICATION_FAILED;
        }
    }
    return this;
}

function _disconnect() {
    if (this.av_chan_id != null) {
        tutk.av_client_stop(this.tutk_platform_lib, this.av_chan_id);
    }
    this.av_chan_id = null;
    if (this.session_id != null) {
        let err_no = tutk.iotc_connect_stop_by_session_id(this.tutk_platform_lib, this.session_id);
        if (err_no < 0) {
            console.warn(tutk.TutkError(err_no));
        }
        tutk.iotc_session_close(this.tutk_platform_lib, this.session_id);
    }
    this.session_id = null;
    this.state = WyzeIOTCSessionState.DISCONNECTED;
}

 