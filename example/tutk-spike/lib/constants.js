"use strict";

/**
 * Tutk Wyze protocol constants.
 *
 * The wire format for messages sent over a Throughtek IOTC control
 * channel between a client (us) and a Wyze camera. Every message is
 * prefixed with a 16-byte header (see header.js).
 *
 * Ported from docker-wyze-bridge
 * (https://github.com/mrlt8/docker-wyze-bridge), specifically
 * `app/wyzecam/tutk/tutk_protocol.py`.
 */

// First two header bytes — ASCII "HL". Hardcoded by the SDK; not a
// configurable thing.
const PREFIX = Buffer.from("HL", "ascii");

// Protocol version field. Stable across all firmwares cryze/dwb have
// tested. If Wyze ever bumps this, the camera will reject our messages
// with a clear error code.
const PROTOCOL_VERSION = 5;

// Header size in bytes. The TutkWyzeProtocolHeader struct is exactly
// this many — anything shorter is rejected by decode().
const HEADER_SIZE = 16;

// Status codes that appear in the K10056 / K10052 family responses.
// Used for human-readable logging; not part of the wire protocol.
const STATUS_MESSAGES = Object.freeze({
  2: "updating",
  4: "checking enr",
  5: "off",
});

// Bitrate constants (from tutk.py) — these are the values you'd pass
// to K10052SetBitrate. Approximate KB/s as documented.
const BITRATE = Object.freeze({
  P360:        0x1E, // ~30 KB/s
  SD:          0x3C, // ~60 KB/s
  HD:          0x78, // ~120 KB/s
  SUPER_HD:    0x96, // ~150 KB/s — higher than the app's "HD" setting
  SUPER_SUPER: 0xF0, // ~240 KB/s — way above what the app ever requests
});

// Frame size constants (from tutk.py). Note the SDK uses these zero-based
// internally, but K10056SetResolvingBit / K10052DBSetResolvingBit both
// pre-increment by 1 before sending — the wire value is constant+1.
const FRAME_SIZE = Object.freeze({
  P1080: 0,
  P360:  1,
  P2K:   3,
  // Doorbell-specific (rotated sensor → portrait):
  DOORBELL_HD: 3,
  DOORBELL_SD: 4,
});

module.exports = {
  PREFIX,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  STATUS_MESSAGES,
  BITRATE,
  FRAME_SIZE,
};
