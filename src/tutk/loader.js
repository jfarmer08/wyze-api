"use strict";

/**
 * Tutk SDK loader — koffi bindings for libIOTCAPIs_ALL.so.
 *
 * Wraps Throughtek's IOTC + AV channel C API in typed JS calls. The
 * `.so` itself is NOT shipped with this package — `fetch-wyze-sdk.js`
 * downloads it on first use, or the caller provides a path explicitly.
 *
 * Platform support:
 *   - Linux x86_64, arm64, armv7 — ✅ supported (the .so docker-wyze-bridge
 *     ships is compiled for standard Linux glibc, no Bionic shim needed)
 *   - macOS, Windows — ❌ not supported (no .dylib / .dll exists)
 *
 * Why no Bionic shim here:
 *   The `libIOTCAPIs_ALL.so` we load is Throughtek's standalone Linux
 *   build — they compile against glibc directly. The Bionic shim
 *   problem only applies to .so files extracted from Android APKs
 *   (which `libiotp2pav.so` for GUTES devices is). That's a separate
 *   loader (src/gutes/loader.js, future).
 *
 * Usage:
 *
 *   const { loadTutk } = require('wyze-api/src/tutk/loader');
 *   const sdk = loadTutk('/path/to/libIOTCAPIs_ALL.so');
 *   const version = sdk.getVersionString();
 *   sdk.iotcInitialize2(0); // any UDP port
 *   ... call camera ...
 *   sdk.iotcDeInitialize();
 *
 * Function-naming convention: camelCase versions of the C symbols.
 *   IOTC_Initialize2  →  iotcInitialize2
 *   IOTC_Connect_ByUIDEx  →  iotcConnectByUidEx
 *   avSendIOCtrl  →  avSendIoCtrl
 *
 * Failure modes:
 *   - .so file missing → throws TutkLoaderError with the path tried
 *   - wrong-arch .so → throws (koffi gives "Failed to dlopen")
 *   - calling on macOS/Windows → throws with clear message; callers
 *     should check `isTutkSupported()` and fall back to cloud streaming
 */

const os = require("os");
const fs = require("fs");
const path = require("path");

class TutkLoaderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "TutkLoaderError";
    if (cause) this.cause = cause;
  }
}

/**
 * Check whether the current platform can load Tutk binaries at all.
 * Cheap call — caller should gate every Tutk feature on this so the
 * non-Linux fallback path is consistent.
 *
 * @returns {{ supported: boolean, platform: string, arch: string, reason?: string }}
 */
function isTutkSupported() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform !== "linux") {
    return {
      supported: false, platform, arch,
      reason: `Tutk requires Linux (got ${platform}); the .so isn't compiled for macOS or Windows`,
    };
  }
  if (!["x64", "arm64", "arm"].includes(arch)) {
    return {
      supported: false, platform, arch,
      reason: `Tutk requires x64/arm64/arm Linux (got ${arch}); docker-wyze-bridge doesn't ship a build for this arch`,
    };
  }
  return { supported: true, platform, arch };
}

/**
 * Default location the loader looks for the .so when no path is given.
 * Matches `fetch-wyze-sdk.js`'s default target directory.
 */
function defaultSoPath() {
  return path.join(os.homedir(), ".homebridge", "wyze-sdk", "libIOTCAPIs_ALL.so");
}

/**
 * Open the Tutk SDK shared library and return a typed JS wrapper.
 *
 * @param {string} [soPath] — absolute path to libIOTCAPIs_ALL.so. If
 *   omitted, uses defaultSoPath().
 * @returns {object} typed function bindings (see method list below)
 */
function loadTutk(soPath) {
  const support = isTutkSupported();
  if (!support.supported) {
    throw new TutkLoaderError(`Tutk not supported on this host: ${support.reason}`);
  }

  const resolved = soPath || defaultSoPath();
  if (!fs.existsSync(resolved)) {
    throw new TutkLoaderError(
      `libIOTCAPIs_ALL.so not found at ${resolved}. ` +
      `Run \`npx wyze-api-fetch-wyze-sdk --type tutk\` to download it.`
    );
  }

  // koffi is loaded lazily — only when someone actually tries to use
  // Tutk. Keeps the dep cost out of normal cloud-only paths.
  let koffi;
  try {
    koffi = require("koffi");
  } catch (e) {
    throw new TutkLoaderError(
      `koffi failed to load. Tutk binding requires koffi to be installed.`,
      e
    );
  }

  let lib;
  try {
    lib = koffi.load(resolved);
  } catch (e) {
    throw new TutkLoaderError(
      `dlopen failed for ${resolved}. The .so may be the wrong architecture ` +
      `for this host (need ${support.arch}), or it may be corrupted (re-run fetch-wyze-sdk with --force).`,
      e
    );
  }

  // ---- Struct definitions ---------------------------------------------
  //
  // These mirror the FormattedStructure definitions in
  // docker-wyze-bridge/app/wyzecam/tutk/tutk.py. ABI-critical: any drift
  // here and koffi will read/write the wrong field offsets.

  const AVClientStartInConfig = koffi.struct("AVClientStartInConfig", {
    cb:                     "uint32_t",
    iotc_session_id:        "uint32_t",
    iotc_channel_id:        "uint8_t",
    timeout_sec:            "uint32_t",
    account_or_identity:    "const char *",
    password_or_token:      "const char *",
    resend:                 "int32_t",
    security_mode:          "uint32_t",
    auth_type:              "uint32_t",
    sync_recv_data:         "int32_t",
  });

  const AVClientStartOutConfig = koffi.struct("AVClientStartOutConfig", {
    cb:                "uint32_t",
    server_type:       "uint32_t",
    resend:            "int32_t",
    two_way_streaming: "int32_t",
    sync_recv_data:    "int32_t",
    security_mode:     "uint32_t",
  });

  // SInfoStructEx — diagnostic info returned by IOTC_Session_Check_Ex.
  // We pack only the fields docker-wyze-bridge actually reads; the
  // struct in the .so is larger but the trailing fields are ignored.
  // Using a flat byte array (sized large enough) keeps us forward-compatible
  // if Throughtek adds fields at the end.
  const SInfoStructExSize = 256; // generous upper bound; .so writes ≤ this

  // ---- Function bindings -----------------------------------------------
  //
  // Each binding uses koffi's `func()` to declare the C signature. Pure
  // ints / pointers map cleanly; structs go through the named struct
  // definitions above.

  const fns = {};
  function bind(name, ret, params) {
    try {
      fns[name] = lib.func(name, ret, params);
    } catch (e) {
      throw new TutkLoaderError(
        `Symbol "${name}" not found in ${resolved}. The .so may be from an ` +
        `incompatible Throughtek SDK version.`,
        e
      );
    }
  }

  // IOTC layer — session + transport
  bind("IOTC_Get_Version_String",   "const char *", []);
  bind("IOTC_Initialize2",          "int32_t",      ["uint16_t"]);
  bind("IOTC_DeInitialize",         "int32_t",      []);
  bind("IOTC_Set_Log_Path",         "int32_t",      ["const char *", "int32_t"]);
  bind("IOTC_Connect_ByUID",        "int32_t",      ["const char *"]);
  bind("IOTC_Connect_ByUIDEx",      "int32_t",      [
    "const char *", "const char *", "const char *", "int32_t", "int32_t", "int32_t"]);
  bind("IOTC_Connect_ByUID_Parallel", "int32_t",    ["const char *", "int32_t"]);
  bind("IOTC_Connect_Stop_BySID",   "int32_t",      ["int32_t"]);
  bind("IOTC_Get_SessionID",        "int32_t",      []);
  bind("IOTC_Check_Device_OnlineEx","int32_t",      [
    "const char *", "uint32_t", "uint32_t", "uint8_t"]);
  bind("IOTC_Session_Close",        "void",         ["int32_t"]);
  bind("IOTC_Session_Check_Ex",     "int32_t",      ["int32_t", "void *"]);
  bind("TUTK_SDK_Set_License_Key",  "int32_t",      ["const char *"]);

  // AV layer — audio/video channels + IOCtrl mux
  bind("avInitialize",              "int32_t",      ["int32_t"]);
  bind("avDeInitialize",            "int32_t",      []);
  bind("avClientStartEx",           "int32_t",      [koffi.pointer(AVClientStartInConfig), koffi.pointer(AVClientStartOutConfig)]);
  bind("avClientStop",              "void",         ["int32_t"]);
  bind("avSendIOCtrl",              "int32_t",      ["int32_t", "uint32_t", "const char *", "int32_t"]);
  bind("avSendIOCtrlExit",          "void",         ["int32_t"]);
  bind("avRecvIOCtrl",              "int32_t",      ["int32_t", "uint32_t *", "char *", "int32_t", "uint32_t"]);
  bind("avRecvFrameData2",          "int32_t",      [
    "int32_t",
    "char *", "int32_t", "int32_t *", "int32_t *",  // frame data buf + sizes
    "char *", "int32_t", "int32_t *",                // frame info buf + size
    "uint32_t *",                                    // frame index
  ]);
  bind("avRecvAudioData",           "int32_t",      [
    "int32_t", "char *", "int32_t", "char *", "int32_t", "uint32_t *"]);
  bind("avClientSetMaxBufSize",     "void",         ["uint32_t"]);
  bind("avClientSetRecvBufMaxSize", "int32_t",      ["int32_t", "uint32_t"]);
  bind("avClientCleanBuf",          "int32_t",      ["int32_t"]);
  bind("avClientCleanAudioBuf",     "int32_t",      ["int32_t"]);
  bind("avClientCleanLocalBuf",     "int32_t",      ["int32_t"]);
  bind("avClientCleanLocalVideoBuf","int32_t",      ["int32_t"]);
  bind("avCheckAudioBuf",           "int32_t",      ["int32_t"]);

  // ---- Wrapped, idiomatic JS API --------------------------------------
  //
  // Most callers should use these instead of the raw `fns.*` — they
  // handle struct allocation, buffer ownership, and Promise wrapping.
  // The raw bindings stay accessible via `.raw` for cases the wrapper
  // doesn't cover.

  return {
    raw: fns,
    koffi,
    soPath: resolved,
    AVClientStartInConfig,
    AVClientStartOutConfig,

    /** SDK version string, e.g. "4.x.x.xxx" */
    getVersionString() {
      return fns.IOTC_Get_Version_String();
    },

    /** Initialize the IOTC subsystem. Pass 0 for random UDP port. */
    iotcInitialize2(udpPort = 0) {
      return fns.IOTC_Initialize2(udpPort);
    },

    /** Shut down the IOTC subsystem. */
    iotcDeInitialize() {
      return fns.IOTC_DeInitialize();
    },

    /** Set a Throughtek license key (some camera lineups require this). */
    setLicenseKey(key) {
      return fns.TUTK_SDK_Set_License_Key(key);
    },

    /** Open an IOTC session by camera UID. Returns the session id (>=0) or an error code. */
    connectByUid(uid) {
      return fns.IOTC_Connect_ByUID(uid);
    },

    /** Same with explicit local/remote endpoints. */
    connectByUidEx(uid, localIp, remoteIp, localPort, remotePort, timeoutMs) {
      return fns.IOTC_Connect_ByUIDEx(uid, localIp, remoteIp, localPort, remotePort, timeoutMs);
    },

    /** Close an open session. */
    sessionClose(sessionId) {
      fns.IOTC_Session_Close(sessionId);
    },

    /**
     * Check session health. Returns a Buffer with the raw SInfoStructEx
     * bytes (caller can parse as needed); error code is in the return value.
     */
    sessionCheckEx(sessionId) {
      const buf = Buffer.alloc(SInfoStructExSize);
      const errno = fns.IOTC_Session_Check_Ex(sessionId, buf);
      return { errno, info: buf };
    },

    avInitialize(maxChannels = 1) {
      return fns.avInitialize(maxChannels);
    },

    avDeInitialize() {
      return fns.avDeInitialize();
    },

    /**
     * Start an AV client channel on top of an existing IOTC session.
     * Returns the av_chan_id (>=0) or a negative error code.
     */
    avClientStartEx({ sessionId, channelId = 0, timeoutSec = 20, username, password, resend = 1, securityMode = 2 }) {
      const avcIn = {
        cb: 40, // sizeof(AVClientStartInConfig) — koffi computes this for us if we pass a struct ptr, but the SDK validates the field
        iotc_session_id: sessionId,
        iotc_channel_id: channelId,
        timeout_sec: timeoutSec,
        account_or_identity: username,
        password_or_token: password,
        resend,
        security_mode: securityMode,
        auth_type: 0,
        sync_recv_data: 0,
      };
      const avcOut = {
        cb: 24,
        server_type: 0,
        resend: 0,
        two_way_streaming: 0,
        sync_recv_data: 0,
        security_mode: 0,
      };
      const chanId = fns.avClientStartEx(avcIn, avcOut);
      return { chanId, out: avcOut };
    },

    /** Stop an AV client channel. */
    avClientStop(chanId) {
      fns.avClientStop(chanId);
    },

    /** Tell pending avRecvIOCtrl calls to return EXIT immediately. */
    avSendIoCtrlExit(chanId) {
      fns.avSendIOCtrlExit(chanId);
    },

    /**
     * Send an IOCtrl frame (i.e. a Tutk K-class message — see
     * src/tutk-spike/lib/messages.js for the catalog).
     *
     * @param {number} chanId
     * @param {number} ctrlType — typically `0x0` for the standard control channel
     * @param {Buffer} data — typically the output of `messages.<KClass>.encode()`
     */
    avSendIoCtrl(chanId, ctrlType, data) {
      const len = data ? data.length : 0;
      const ptr = data || null;
      return fns.avSendIOCtrl(chanId, ctrlType, ptr, len);
    },

    /**
     * Receive an IOCtrl frame (response from the camera). Blocks until
     * data is available or the timeout (in ms) expires.
     *
     * @returns {{ ctrlType: number, data: Buffer } | { errno: number }}
     */
    avRecvIoCtrl(chanId, timeoutMs = 1000, maxLen = 65536) {
      const buf = Buffer.alloc(maxLen);
      const typeOut = Buffer.alloc(4); // uint32
      const errno = fns.avRecvIOCtrl(chanId, typeOut, buf, maxLen, timeoutMs);
      if (errno < 0) return { errno };
      return {
        ctrlType: typeOut.readUInt32LE(0),
        data: Buffer.from(buf.subarray(0, errno)),
      };
    },
  };
}

module.exports = {
  loadTutk,
  isTutkSupported,
  defaultSoPath,
  TutkLoaderError,
};
