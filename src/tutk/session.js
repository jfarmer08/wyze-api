"use strict";

/**
 * Tutk session orchestrator — Promise-based wrapper over the koffi
 * loader for end-to-end camera sessions.
 *
 * Responsibilities:
 *   - SDK lifecycle (init / deinit / refcount across multiple sessions)
 *   - Per-camera IOTC session setup + auth handshake
 *   - IOCtrl mux: send a K-class request, await its matching K-class
 *     response (matched by `code+1` per the protocol convention)
 *   - Cleanup on errors + graceful teardown
 *
 * Threading model:
 *   The Throughtek SDK is synchronous — `avRecvIOCtrl` blocks. We run
 *   those blocking calls in a background worker via `Worker` so they
 *   don't stall the Node event loop. Each open session has one
 *   listener worker that pumps incoming IOCtrls into a per-code
 *   Promise queue. Sends are non-blocking (avSendIOCtrl returns
 *   immediately).
 *
 *   NOTE: for the Phase 1 spike we keep the listener inline rather
 *   than threaded. Real production wants the worker — that's flagged
 *   as a TODO so we don't ship a thread-blocking implementation by
 *   accident.
 *
 * Failure modes:
 *   - .so not loaded → bubbles TutkLoaderError from the constructor
 *   - IOTC_Connect_* returns negative → throws with the SDK error code
 *   - Auth handshake fails → throws with the camera's status code
 *   - K-class send to a closed channel → throws SessionClosedError
 *
 * Usage:
 *
 *   const { TutkSession } = require('wyze-api/src/tutk/session');
 *   const sess = new TutkSession({ uid, enr, productModel, phoneId, openUserId });
 *   await sess.connect();
 *   const time = await sess.send(new M.K10090GetCameraTime());
 *   await sess.send(new M.K10042SetNightVisionStatus(M.NV_AUTO));
 *   await sess.close();
 */

const path = require("path");

const { loadTutk, isTutkSupported, defaultSoPath, TutkLoaderError } = require("./loader");
const codec = require("../../example/tutk-spike/lib/codec");
const auth = require("../../example/tutk-spike/lib/auth");
const M = require("../../example/tutk-spike/lib/messages");

// ---- SDK ref-counted lifetime ------------------------------------------
//
// IOTC_Initialize2 / IOTC_DeInitialize are process-wide. Multiple
// TutkSession instances share one initialization; we ref-count opens.

let _sdk = null;
let _refcount = 0;

function _acquireSdk(soPath) {
  if (_sdk) {
    _refcount++;
    return _sdk;
  }
  _sdk = loadTutk(soPath);
  const err = _sdk.iotcInitialize2(0);
  if (err < 0) {
    _sdk = null;
    throw new TutkLoaderError(`IOTC_Initialize2 returned ${err}`);
  }
  const ar = _sdk.avInitialize(8); // max 8 channels — generous for ~10 cameras
  if (ar < 0) {
    _sdk.iotcDeInitialize();
    _sdk = null;
    throw new TutkLoaderError(`avInitialize returned ${ar}`);
  }
  _refcount = 1;
  return _sdk;
}

function _releaseSdk() {
  _refcount--;
  if (_refcount > 0) return;
  if (_sdk) {
    try { _sdk.avDeInitialize(); } catch (_) {}
    try { _sdk.iotcDeInitialize(); } catch (_) {}
    _sdk = null;
  }
}

// ---- Errors ------------------------------------------------------------

class TutkSessionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TutkSessionError";
    if (code !== undefined) this.code = code;
  }
}

class SessionClosedError extends TutkSessionError {
  constructor() {
    super("Tutk session is closed");
    this.name = "SessionClosedError";
  }
}

// ---- TutkSession -------------------------------------------------------

class TutkSession {
  /**
   * @param {Object} opts
   * @param {string} opts.uid — camera UID (from Wyze cloud device list)
   * @param {string} opts.enr — camera enr secret (Wyze cloud)
   * @param {string} opts.productModel — Wyze model code (e.g. "WYZE_CAKP2JFUS")
   * @param {string} opts.mac — camera mac (for K10002 legacy auth)
   * @param {string} opts.phoneId — any unique identifier for this client
   * @param {string} opts.openUserId — Wyze account open_user_id
   * @param {boolean} [opts.audio=false]
   * @param {number} [opts.connectTimeoutMs=25000] — JS-side ceiling on
   *   the IOTC_Connect_ByUID call. The SDK's own timeout is ~30s; this
   *   guarantees we surface a clear error to the caller well before
   *   any background hang becomes a debugging nightmare.
   * @param {string} [opts.soPath] — override .so location (default ~/.homebridge/wyze-sdk/...)
   * @param {(model, protocol, command) => boolean} [opts.supports]
   * @param {(level, msg) => void} [opts.log] — logger
   */
  constructor(opts) {
    if (!opts.uid) throw new Error("TutkSession requires opts.uid");
    if (!opts.enr) throw new Error("TutkSession requires opts.enr");
    if (!opts.productModel) throw new Error("TutkSession requires opts.productModel");
    if (!opts.phoneId) throw new Error("TutkSession requires opts.phoneId");
    if (!opts.openUserId) throw new Error("TutkSession requires opts.openUserId");

    this.opts = opts;
    this.log = opts.log || ((_l, _m) => {});
    this.sdk = null;
    this.sessionId = -1;
    this.avChanId = -1;
    this.state = "init"; // "init" | "connected" | "authed" | "closed"

    // Pending K-class futures keyed by expected response code.
    // Format: Map<number, Array<{resolve, reject, deadline}>>
    this._pending = new Map();

    // Polling control for the inline receive loop.
    this._receiveInterval = null;
  }

  // ---- Lifecycle -------------------------------------------------------

  async connect() {
    if (this.state !== "init") {
      throw new TutkSessionError(`connect() called in state ${this.state}`);
    }
    const support = isTutkSupported();
    if (!support.supported) {
      throw new TutkLoaderError(`Tutk not supported on this host: ${support.reason}`);
    }
    this.sdk = _acquireSdk(this.opts.soPath);
    this.log("info", `Tutk SDK version: ${this.sdk.getVersionString()}`);

    // 1. Open IOTC session by UID. This blocks synchronously inside
    //    the SDK until either a session opens or its internal timeout
    //    fires (usually 15–30s). On Docker Desktop for Mac, where
    //    --network host points at the Docker VM's network and not
    //    your LAN, this hang has no upper bound from the caller's
    //    perspective — so we wrap with an explicit JS-side timeout
    //    and force-cleanup on miss.
    //
    //    The connectTimeoutMs option lets callers tune this; default
    //    is 25s which is just under the SDK's own ~30s typical limit.
    const connectTimeoutMs = this.opts.connectTimeoutMs || 25_000;
    const sid = await this._withTimeout(
      () => this.sdk.connectByUid(this.opts.uid),
      connectTimeoutMs,
      `IOTC_Connect_ByUID timed out after ${connectTimeoutMs}ms (no response from camera ${this.opts.uid})`
    );
    if (sid < 0) {
      _releaseSdk();
      throw new TutkSessionError(`IOTC_Connect_ByUID returned ${sid}`, sid);
    }
    this.sessionId = sid;
    this.log("info", `IOTC session ${sid} established to ${this.opts.uid}`);

    // 2. Start AV client channel on top of the IOTC session
    const { chanId, out } = this.sdk.avClientStartEx({
      sessionId: sid,
      channelId: 0,
      timeoutSec: 20,
      username: this.opts.phoneId,
      password: this.opts.openUserId, // SDK uses this slot for auth
      resend: 1,
      securityMode: 2,
    });
    if (chanId < 0) {
      this.sdk.sessionClose(sid);
      _releaseSdk();
      throw new TutkSessionError(`avClientStartEx returned ${chanId}`, chanId);
    }
    this.avChanId = chanId;
    this.log("info", `AV channel ${chanId} started (server_type=${out.server_type})`);
    this.state = "connected";

    // 3. Start the receive pump
    this._startReceiver();

    // 4. Do the Wyze auth handshake (K10000 → K10001 → K10002/6/8)
    await this._authenticate();
    this.state = "authed";

    return this;
  }

  async _authenticate() {
    // Step A: K10000 (connect request). The default parseResponse
    // returns the raw 17-byte K10001 payload, which is exactly what
    // buildAuthResponse needs as `data` below.
    //
    // (Earlier draft of this code did `await send()` then a separate
    // `_waitFor(10001)` — that double-awaits K10001, with the second
    // wait blocking forever since the camera only sends one. Don't
    // bring it back.)
    const k10001 = await this.send(new M.K10000ConnectRequest(null), 5000);

    // Step B: pick the right auth K-class based on model/protocol
    const respMsg = auth.buildAuthResponse({
      data: k10001,
      protocol: 5, // matches our header.js default
      enr: this.opts.enr,
      productModel: this.opts.productModel,
      mac: this.opts.mac || this.opts.uid,
      phoneId: this.opts.phoneId,
      openUserId: this.opts.openUserId,
      audio: !!this.opts.audio,
      supports: this.opts.supports || (() => true),
    });
    if (respMsg && respMsg.busyReason) {
      throw new TutkSessionError(`Camera busy: ${respMsg.busyReason}`);
    }
    if (respMsg && respMsg.unexpectedStatus !== undefined) {
      throw new TutkSessionError(`Camera returned unexpected status ${respMsg.unexpectedStatus}`);
    }
    if (!respMsg) throw new TutkSessionError("auth.buildAuthResponse returned null");

    // Step C: send K10002/6/8, await its response (K10003/7/9 = code+1)
    const authResult = await this.send(respMsg, 5000);
    this.log("info", `Auth OK: ${JSON.stringify(authResult).slice(0, 120)}`);
    return authResult;
  }

  async close() {
    if (this.state === "closed") return;
    this.state = "closed";
    if (this._receiveInterval) {
      clearInterval(this._receiveInterval);
      this._receiveInterval = null;
    }
    // Cancel all pending Promises
    for (const [code, waiters] of this._pending) {
      for (const w of waiters) w.reject(new SessionClosedError());
    }
    this._pending.clear();
    if (this.avChanId >= 0 && this.sdk) {
      try { this.sdk.avSendIoCtrlExit(this.avChanId); } catch (_) {}
      try { this.sdk.avClientStop(this.avChanId); } catch (_) {}
      this.avChanId = -1;
    }
    if (this.sessionId >= 0 && this.sdk) {
      try { this.sdk.sessionClose(this.sessionId); } catch (_) {}
      this.sessionId = -1;
    }
    _releaseSdk();
    this.sdk = null;
  }

  // ---- Send / receive --------------------------------------------------

  /**
   * Send a K-class request and await the matching response.
   *
   * @param {M.WyzeProtocolMessage} msg
   * @param {number} [timeoutMs=10000]
   * @returns {Promise<*>} the camera's parsed response
   */
  send(msg, timeoutMs = 10000) {
    if (this.state === "closed") return Promise.reject(new SessionClosedError());
    if (this.avChanId < 0) {
      return Promise.reject(new TutkSessionError("AV channel not open"));
    }

    const wireBytes = msg.encode();
    const sendErr = this.sdk.avSendIoCtrl(this.avChanId, 0, wireBytes);
    if (sendErr < 0) {
      return Promise.reject(new TutkSessionError(`avSendIOCtrl returned ${sendErr}`, sendErr));
    }
    return this._waitFor(msg.expectedResponseCode, timeoutMs).then((payload) =>
      msg.parseResponse(payload)
    );
  }

  _waitFor(expectedCode, timeoutMs) {
    return new Promise((resolve, reject) => {
      const arr = this._pending.get(expectedCode) || [];
      const deadline = Date.now() + timeoutMs;
      arr.push({ resolve, reject, deadline });
      this._pending.set(expectedCode, arr);
    });
  }

  /**
   * Inline receive pump. Polls avRecvIOCtrl on a short interval; each
   * received frame goes through the codec, then dispatches to whichever
   * future is waiting on that K-class code.
   *
   * TODO(phase 1.5): move this into a Worker thread so the blocking
   * avRecvIOCtrl call doesn't pin the event loop. For the Phase 1
   * spike, a small per-tick poll with a tight timeout is fine — the
   * SDK returns immediately if no data is available.
   */
  _startReceiver() {
    this._receiveInterval = setInterval(() => {
      if (this.state === "closed") return;
      // 1 ms timeout — non-blocking poll
      const { errno, ctrlType, data } = this.sdk.avRecvIoCtrl(this.avChanId, 1);
      if (errno !== undefined && errno < 0) {
        // Most negative errnos here mean "no data, try again" — only log on real errors.
        // -20015 is AV_ER_DATA_NOREADY which is normal idle.
        if (errno !== -20015 && errno !== -20012) {
          this.log("warn", `avRecvIOCtrl errno=${errno}`);
        }
        // Also walk pending and reject any expired waiters
        this._expirePending();
        return;
      }
      if (!data || data.length < 16) return;
      let parsed;
      try {
        parsed = codec.decode(data);
      } catch (e) {
        this.log("debug", `decode error on inbound IOCtrl: ${e.message}`);
        return;
      }
      const code = parsed.header.code;
      const waiters = this._pending.get(code);
      if (!waiters || waiters.length === 0) {
        // Unsolicited message — log + ignore. Real handlers can be
        // added later (event push, etc.).
        this.log("debug", `unsolicited IOCtrl code=${code}, txt_len=${parsed.header.txt_len}`);
        return;
      }
      const w = waiters.shift();
      w.resolve(parsed.payload || Buffer.alloc(0));
    }, 20); // 50Hz poll — light enough for control, not for streaming
  }

  /**
   * Run a synchronous SDK call in the next event-loop tick and race it
   * against a JS-side timeout. The SDK call still blocks for the
   * full timeout if the network never responds — we can't actually
   * interrupt a sync call across the FFI boundary — but the *promise*
   * resolves on time, so callers can move on and we can mark the
   * session as broken without hanging indefinitely.
   *
   * In practice the SDK has its own internal timeout (15–30s) and
   * returns a negative error code, so the orphaned thread cleans up
   * shortly after our JS timeout fires.
   *
   * @template T
   * @param {() => T} fn
   * @param {number} timeoutMs
   * @param {string} errMessage
   * @returns {Promise<T>}
   */
  _withTimeout(fn, timeoutMs, errMessage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new TutkSessionError(errMessage));
        }
      }, timeoutMs);
      // setImmediate keeps the synchronous SDK call off the same tick
      // as the timer setup; otherwise a slow JS-side step before fn()
      // would also count against the budget.
      setImmediate(() => {
        try {
          const result = fn();
          if (!settled) {
            settled = true;
            clearTimeout(t);
            resolve(result);
          }
        } catch (e) {
          if (!settled) {
            settled = true;
            clearTimeout(t);
            reject(e);
          }
        }
      });
    });
  }

  _expirePending() {
    const now = Date.now();
    for (const [code, waiters] of this._pending) {
      const survivors = [];
      for (const w of waiters) {
        if (w.deadline <= now) {
          w.reject(new TutkSessionError(`Timed out waiting for K-class ${code}`));
        } else {
          survivors.push(w);
        }
      }
      if (survivors.length) this._pending.set(code, survivors);
      else this._pending.delete(code);
    }
  }
}

module.exports = {
  TutkSession,
  TutkSessionError,
  SessionClosedError,
  // Internal — exposed for tests
  _internal: { _acquireSdk, _releaseSdk },
};
