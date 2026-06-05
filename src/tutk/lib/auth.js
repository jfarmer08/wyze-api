"use strict";

/**
 * Tutk auth helpers — port of `respond_to_ioctrl_10001` and
 * `generate_challenge_response` from docker-wyze-bridge's
 * `app/wyzecam/tutk/tutk_protocol.py`.
 *
 * The Wyze auth handshake works like this:
 *
 *   1. Client → K10000 (connect request)
 *   2. Camera → K10001 (16-byte challenge: status byte + 16 enc bytes)
 *   3. Client xxtea-decrypts the 16 challenge bytes with the camera's
 *      `enr` (or a derived secret depending on camera_status)
 *   4. Client → K10002 / K10006 / K10008 (one of three auth variants,
 *      picked by camera model + protocol version) carrying the 16-byte
 *      decrypted response
 *   5. Camera → K10003 / K10007 / K10009 (JSON: success or rejection)
 *
 * STATUS_MESSAGES (codes that mean the camera can't auth right now):
 *   2 = updating
 *   4 = checking enr
 *   5 = off
 *
 * Camera statuses that DO auth (each picks a different key path):
 *   1 = legacy — secret_key = "FFFFFFFFFFFFFFFF" (ASCII)
 *   3 = standard — secret_key = enr[0..16]
 *   6 = doorbell — decrypt the challenge with enr[0..16] first, then
 *       decrypt again with enr[16..32]
 */

const xxtea = require("./xxtea");
const { STATUS_MESSAGES } = require("./constants");
const M = require("./messages");

/**
 * Decrypt the camera's challenge bytes per the camera_status path.
 * Returns the 16-byte challenge_response that goes into K10002/6/8.
 *
 * @param {Buffer} cameraEnrB — 16 bytes from K10001 response (the encrypted challenge)
 * @param {string} enr — the camera's enr secret (typically 16 or 32 ASCII chars)
 * @param {number} cameraStatus — 1, 3, or 6
 * @returns {Buffer} 16-byte plaintext challenge response
 */
function generateChallengeResponse(cameraEnrB, enr, cameraStatus) {
  if (!Buffer.isBuffer(cameraEnrB) || cameraEnrB.length !== 16) {
    throw new Error(`cameraEnrB must be 16 bytes, got ${cameraEnrB?.length}`);
  }
  const enrBuf = Buffer.from(enr, "ascii");

  let camB = cameraEnrB;
  let secret;
  if (cameraStatus === 3) {
    if (enrBuf.length < 16) throw new Error("enr expected to be ≥16 bytes for status=3");
    secret = enrBuf.subarray(0, 16);
  } else if (cameraStatus === 6) {
    if (enrBuf.length < 32) throw new Error("enr expected to be ≥32 bytes for status=6");
    const innerKey = enrBuf.subarray(0, 16);
    camB = xxtea.decrypt(cameraEnrB, innerKey);
    secret = enrBuf.subarray(16, 32);
  } else {
    // Legacy / unknown — Python uses the fixed string "FFFFFFFFFFFFFFFF"
    secret = Buffer.from("FFFFFFFFFFFFFFFF", "ascii");
  }

  return xxtea.decrypt(camB, secret);
}

/**
 * Given the K10001 response from a camera, pick the right K-class to
 * reply with and construct it.
 *
 * Returns null if the camera is in a "can't auth right now" state
 * (updating / checking enr / off); caller should back off + retry.
 *
 * @param {Object} args
 * @param {Buffer} args.data — K10001 response payload (≥17 bytes:
 *   1B status + 16B challenge)
 * @param {number} args.protocol — protocol version field from header
 * @param {string} args.enr — camera enr secret
 * @param {string} args.productModel — Wyze product code
 * @param {string} args.mac — camera mac
 * @param {string} args.phoneId — client phone_id (any unique identifier)
 * @param {string} args.openUserId — Wyze account user_id
 * @param {boolean} [args.audio=false] — request audio in stream
 * @param {(model: string, protocol: number, command: number) => boolean} [args.supports]
 *   — optional capability check, defaults to "always true" (caller-supplied
 *      device_config.json lookup in the full integration)
 * @param {string[]} [args.doorbellModels] — models that should use K10006
 * @returns {object|null} an instance of K10002/K10006/K10008, or null
 */
function buildAuthResponse(args) {
  const {
    data, protocol, enr, productModel, mac, phoneId, openUserId,
    audio = false,
    supports = () => true,
    doorbellModels = ["WYZEDB3", "GW_BE1", "AN_RDB1"],
  } = args;

  if (!Buffer.isBuffer(data) || data.length < 17) {
    throw new Error("K10001 response must be ≥17 bytes (status + 16B challenge)");
  }
  const cameraStatus = data.readUInt8(0);
  const cameraEnrB = data.subarray(1, 17);

  if (STATUS_MESSAGES[cameraStatus]) {
    // Camera is updating / checking enr / off — can't auth.
    return { busyReason: STATUS_MESSAGES[cameraStatus] };
  }
  if (cameraStatus !== 1 && cameraStatus !== 3 && cameraStatus !== 6) {
    return { unexpectedStatus: cameraStatus };
  }

  const resp = generateChallengeResponse(cameraEnrB, enr, cameraStatus);

  if (doorbellModels.includes(productModel) && supports(productModel, protocol, 10006)) {
    return new M.K10006ConnectUserAuth(resp, phoneId, openUserId, true, audio);
  }
  if (supports(productModel, protocol, 10008)) {
    return new M.K10008ConnectUserAuth(resp, phoneId, openUserId, true, audio);
  }
  return new M.K10002ConnectAuth(resp, mac, true, audio);
}

module.exports = {
  generateChallengeResponse,
  buildAuthResponse,
};
