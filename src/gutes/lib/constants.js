"use strict";

/**
 * GUTES protocol constants — frame type codes, header size, and the
 * human-readable name map used by the logger.
 *
 * Ported from cryze (src/relay/constants.py). The values come from RE
 * of Wyze's libiotp2pav.so dispatch table — see
 * https://github.com/carTloyal123/cryze/blob/main/docs/architecture.md
 * for the protocol overview.
 *
 * Stable per the cryze project. New types get added when Wyze ships
 * new firmware; the existing ones haven't changed across the years
 * cryze has been tracking them.
 */

// Frame type codes (from giot_on_rcvpkt dispatch table)
const TYPES = Object.freeze({
  DETECT_REQ:          0x01,
  DETECT_RESP:         0x02,
  CERTIFY_REQ:         0x0C,
  CERTIFY_RESP:        0x0D,
  LIST_REQ:            0x15,
  LIST_RESP:           0x16,
  KEEPALIVE:           0x17,
  SUBSCRIBE:           0xA0,
  SUBSCRIBE_RESP:      0xA1,
  MTP_RES_RESPONSE:    0xA2,
  // MTP_RES_RESP_A3 vs MTP_RES_RESPONSE (0xA2) — both are "MTP resource
  // response" but 0xA3 carries the relay-server list (used during
  // session setup), 0xA2 carries NAT info for direct LAN P2P.
  MTP_RES_RESP_A3:     0xA3,
  CALLING_REQ:         0xA4,
  INIT_INFO_MSG:       0xA6,
  GDM_PUSH:            0xA7,
  CALLING_ERR:         0xAA,
  SESSION_CTL:         0xB0,
  SESSION_CTL_RESP:    0xB1,
  ONLINE_MSG:          0xB4,
  WAKEUP:              0xBB, // sent by Mars to wake sleeping devices
  PASSTHROUGH:         0xBD,
  MTP_DATA:            0xCA, // the video stream — direct LAN UDP after CALLING completes
});

// Human-readable label for each type. Used in log formatting so an
// unknown 0x?? value still prints with the raw code instead of a
// blank.
const FRAME_TYPE_NAMES = Object.freeze({
  [TYPES.DETECT_REQ]:       "DETECT_REQ",
  [TYPES.DETECT_RESP]:      "DETECT_RESP",
  [TYPES.CERTIFY_REQ]:      "CERTIFY",
  [TYPES.CERTIFY_RESP]:     "CERTIFY_RESP",
  [TYPES.LIST_REQ]:         "LIST_REQ",
  [TYPES.LIST_RESP]:        "LIST_RESP",
  [TYPES.KEEPALIVE]:        "KEEPALIVE",
  [TYPES.SUBSCRIBE]:        "SUBSCRIBE",
  [TYPES.SUBSCRIBE_RESP]:   "SUBSCRIBE_RESP",
  [TYPES.MTP_RES_RESPONSE]: "MTP_RES_RESP",
  [TYPES.MTP_RES_RESP_A3]:  "MTP_RES_RESP_A3",
  [TYPES.CALLING_REQ]:      "CALLING_REQ",
  [TYPES.WAKEUP]:           "WAKEUP",
  [TYPES.INIT_INFO_MSG]:    "INIT_INFO",
  [TYPES.GDM_PUSH]:         "GDM_PUSH",
  [TYPES.CALLING_ERR]:      "CALLING_ERR/GDM",
  [TYPES.SESSION_CTL]:      "SESSION_CTL",
  [TYPES.SESSION_CTL_RESP]: "SESSION_CTL_RESP",
  [TYPES.ONLINE_MSG]:       "ONLINE_MSG",
  [TYPES.PASSTHROUGH]:      "PASSTHROUGH",
  [TYPES.MTP_DATA]:         "MTP_DATA",
});

function frameTypeName(code) {
  return FRAME_TYPE_NAMES[code] || `UNKNOWN_0x${code.toString(16).padStart(2, "0").toUpperCase()}`;
}

// Header size in bytes (0x1C = 28). Every GUTES frame starts with
// this fixed-size header; payload follows.
const HEADER_SIZE = 0x1C;

// Protocol byte values for the first header field. Determines how
// the frame's term_id is interpreted and which dispatch path runs.
const PROTOCOL = Object.freeze({
  RELAY:     0x7F,
  SESSION:   0x7E,
  BROADCAST: 0x70,
});

module.exports = {
  TYPES,
  FRAME_TYPE_NAMES,
  frameTypeName,
  HEADER_SIZE,
  PROTOCOL,
};
