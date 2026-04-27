/**
 * Headless WebRTC frame capture.
 *
 * Negotiates a WebRTC session against a Wyze camera using its Kinesis Video
 * signaling URL, receives the H.264 RTP stream via werift, forwards the
 * packets to a local UDP socket, and pipes that into FFmpeg to extract a
 * single JPEG frame.
 *
 * The ffmpeg binary is provided by the `ffmpeg-static` npm package — no
 * system install needed. Falls back to `ffmpeg` on PATH if ffmpeg-static
 * fails to resolve (e.g., unsupported platform).
 */

const dgram = require("dgram");
const fs = require("fs");
const os = require("os");
const path = require("path");
const nodeCrypto = require("crypto");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { RTCPeerConnection, RTCRtpCodecParameters } = require("werift");

// Pin H.264 baseline 3.1 — Wyze rejects VP8/VP9 and werift's defaults include those.
const H264_CODECS = [
  new RTCRtpCodecParameters({
    mimeType: "video/H264",
    clockRate: 90000,
    rtcpFeedback: [
      { type: "nack" },
      { type: "nack", parameter: "pli" },
      { type: "goog-remb" },
    ],
    parameters:
      "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
  }),
];

// Accept PCMU (G.711 µ-law, PT 0) and Opus — let the camera pick whichever it supports.
const AUDIO_CODECS = [
  new RTCRtpCodecParameters({ mimeType: "audio/PCMU", clockRate: 8000, channels: 1 }),
  new RTCRtpCodecParameters({
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: "minptime=10;useinbandfec=1",
  }),
];

let _ffmpegBinaryPath = null;
function resolveFfmpegPath() {
  if (_ffmpegBinaryPath) return _ffmpegBinaryPath;
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      _ffmpegBinaryPath = ffmpegStatic;
      return _ffmpegBinaryPath;
    }
  } catch (_) { /* fall through */ }
  _ffmpegBinaryPath = "ffmpeg";
  return _ffmpegBinaryPath;
}

async function pickFreeUdpPort() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", reject);
    sock.bind(0, "127.0.0.1", () => {
      const { port } = sock.address();
      sock.close(() => resolve(port));
    });
  });
}

function writeSdpFile(rtpPort) {
  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=WyzeCapture
c=IN IP4 127.0.0.1
t=0 0
m=video ${rtpPort} RTP/AVP 96
a=rtpmap:96 H264/90000
a=fmtp:96 packetization-mode=1
`;
  const sdpPath = path.join(
    os.tmpdir(),
    `wyze-capture-${process.pid}-${nodeCrypto.randomBytes(4).toString("hex")}.sdp`
  );
  fs.writeFileSync(sdpPath, sdp);
  return sdpPath;
}

function localIpAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const entry of iface) {
      if (!entry.internal && entry.family === "IPv4") return entry.address;
    }
  }
  return "0.0.0.0";
}

// Audio SDP accepts both PCMU (PT 0) and Opus (PT 111) so FFmpeg handles either codec.
function writeAudioSdpFile(rtpPort) {
  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=WyzeAudio
c=IN IP4 127.0.0.1
t=0 0
m=audio ${rtpPort} RTP/AVP 0 111
a=rtpmap:0 PCMU/8000
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
`;
  const sdpPath = path.join(
    os.tmpdir(),
    `wyze-audio-${process.pid}-${nodeCrypto.randomBytes(4).toString("hex")}.sdp`
  );
  fs.writeFileSync(sdpPath, sdp);
  return sdpPath;
}

function _spawnFfmpeg(sdpPath) {
  return spawn(resolveFfmpegPath(), [
    "-loglevel", "error",
    "-protocol_whitelist", "file,rtp,udp",
    "-fflags", "+genpts+discardcorrupt+nobuffer",
    "-flags", "low_delay",
    "-i", sdpPath,
    "-frames:v", "1",
    "-vsync", "passthrough",
    "-f", "image2",
    "-c:v", "mjpeg",
    "-q:v", "2",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Send a signaling message in the format the Wyze/Kinesis WebRTC service
 * expects: a JSON envelope with base64-encoded inner payload.
 */
function _sendSignal(ws, action, payload, recipientClientId = "MASTER") {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    action,
    messagePayload: Buffer.from(JSON.stringify(payload)).toString("base64"),
    recipientClientId,
  }));
}

function _parseSignalMessage(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const env = JSON.parse(raw);
    const type = env.messageType || env.action;
    if (!type) return null;
    let payload = null;
    if (env.messagePayload) {
      try {
        payload = JSON.parse(Buffer.from(env.messagePayload, "base64").toString("utf8"));
      } catch (_) { /* keep null */ }
    }
    return { type, payload };
  } catch (_) {
    return null;
  }
}

/**
 * Capture a single JPEG frame from a Wyze camera's WebRTC stream.
 *
 * @param {Object} params
 * @param {string} params.signalingUrl — Kinesis Video signaling URL (signed)
 * @param {Array<{urls:string, username?:string, credential?:string}>} params.iceServers
 * @param {Object} [params.logger] — optional logger with .debug/.warning/.error
 * @param {number} [params.timeoutMs=20000] — overall timeout
 * @returns {Promise<Buffer>} JPEG image bytes
 */
async function captureStreamFrame({
  signalingUrl,
  iceServers,
  logger = null,
  timeoutMs = 20_000,
}) {
  const log = (level, msg) => {
    if (!logger) return;
    if (typeof logger[level] === "function") logger[level](`[capture] ${msg}`);
  };

  const rtpPort = await pickFreeUdpPort();
  const sdpPath = writeSdpFile(rtpPort);

  let ffmpeg = null;
  let pc = null;
  let ws = null;
  let fwdSock = null;
  const cleanup = () => {
    // Silence the WS error event before closing — closing mid-handshake
    // fires an async "WebSocket was closed before connection was established"
    // error that would otherwise be an unhandled rejection.
    try { if (ws) { ws.removeAllListeners("error"); ws.on("error", () => {}); ws.close(); } } catch (_) {}
    try { pc?.close(); } catch (_) {}
    try { fwdSock?.close(); } catch (_) {}
    try { ffmpeg?.kill("SIGKILL"); } catch (_) {}
    try { fs.unlinkSync(sdpPath); } catch (_) {}
  };

  try {
    ffmpeg = _spawnFfmpeg(sdpPath);
    fwdSock = dgram.createSocket("udp4");

    const stdoutChunks = [];
    const stderrChunks = [];
    ffmpeg.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    // Attach error/close handlers immediately so spawn failures (ENOENT,
    // crashes) reject the outcome promise instead of going unhandled and
    // crashing the Node process.
    const ffmpegOutcome = new Promise((resolve, reject) => {
      ffmpeg.once("error", (err) => {
        if (err && err.code === "ENOENT") {
          reject(new Error(
            `ffmpeg binary not found (tried: ${resolveFfmpegPath()}). ` +
            "Re-run `npm install` to fetch the bundled ffmpeg via ffmpeg-static, " +
            "or install ffmpeg on your system PATH if your platform isn't supported."
          ));
        } else {
          reject(err);
        }
      });
      ffmpeg.once("close", (code) => {
        if (stdoutChunks.length > 0) resolve(Buffer.concat(stdoutChunks));
        else reject(new Error(`ffmpeg exited (${code}) without producing a frame: ${Buffer.concat(stderrChunks).toString()}`));
      });
    });

    pc = new RTCPeerConnection({
      iceServers,
      codecs: { video: H264_CODECS },
    });
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.onTrack.subscribe((track) => {
      log("debug", `track received kind=${track.kind} codec=${track.codec?.name}`);
      track.onReceiveRtp.subscribe((rtp) => {
        try {
          fwdSock.send(rtp.serialize(), rtpPort, "127.0.0.1");
        } catch (_) { /* socket may be closed */ }
      });
    });

    ws = new WebSocket(signalingUrl);
    const remoteAnswered = new Promise((resolve, reject) => {
      const onMsg = async (raw) => {
        const msg = _parseSignalMessage(raw.toString());
        if (!msg) return;
        try {
          if (msg.type === "SDP_ANSWER") {
            await pc.setRemoteDescription(msg.payload);
            log("debug", "applied SDP_ANSWER");
            resolve();
          } else if (msg.type === "ICE_CANDIDATE") {
            await pc.addIceCandidate(msg.payload);
          }
        } catch (err) {
          reject(err);
        }
      };
      ws.on("message", onMsg);
      ws.once("error", reject);
      ws.once("close", (code) => {
        if (code !== 1000) reject(new Error(`signaling WS closed (${code})`));
      });
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`capture timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    await Promise.race([
      new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      }),
      ffmpegOutcome,  // fail fast if ffmpeg dies (e.g. ENOENT) instead of hanging on WS open
      timeout,
    ]);
    log("debug", "signaling open, sending offer");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    _sendSignal(ws, "SDP_OFFER", { type: "offer", sdp: pc.localDescription.sdp });

    pc.onIceCandidate.subscribe((c) => {
      if (c?.candidate) _sendSignal(ws, "ICE_CANDIDATE", c);
    });

    await Promise.race([remoteAnswered, ffmpegOutcome, timeout]);
    log("debug", "WebRTC negotiation complete, waiting for frame");
    const buffer = await Promise.race([ffmpegOutcome, timeout]);
    log("debug", `captured ${buffer.length} bytes`);
    return buffer;
  } finally {
    cleanup();
  }
}

/**
 * Establish a long-lived WebRTC connection to a Wyze camera and forward every
 * incoming H.264 RTP packet to `localRtpPort` on 127.0.0.1 via UDP.
 *
 * Returns a `{ stop() }` handle. Call `stop()` to close the WebRTC peer and
 * the forwarding socket.
 *
 * @param {Object} params
 * @param {string} params.signalingUrl
 * @param {Array}  params.iceServers
 * @param {number} params.localRtpPort — UDP port FFmpeg is listening on
 * @param {Object} [params.logger]
 * @param {number} [params.timeoutMs=15000] — signaling negotiation timeout
 * @returns {Promise<{stop:Function}>}
 */
async function startRtpForwarding({
  signalingUrl,
  iceServers,
  localRtpPort,
  localAudioRtpPort = null,
  logger = null,
  timeoutMs = 15_000,
}) {
  const log = (level, msg) => {
    if (!logger) return;
    if (typeof logger[level] === "function") logger[level](`[stream] ${msg}`);
  };

  const videoSock = dgram.createSocket("udp4");
  videoSock.bind(0, "127.0.0.1");

  const audioSock = localAudioRtpPort ? dgram.createSocket("udp4") : null;
  if (audioSock) audioSock.bind(0, "127.0.0.1");

  const codecs = { video: H264_CODECS };
  if (localAudioRtpPort) codecs.audio = AUDIO_CODECS;

  const pc = new RTCPeerConnection({ iceServers, codecs });
  pc.addTransceiver("video", { direction: "recvonly" });
  if (localAudioRtpPort) pc.addTransceiver("audio", { direction: "recvonly" });

  pc.onTrack.subscribe((track) => {
    log("debug", `forwarding track kind=${track.kind}`);
    if (track.kind === "video") {
      track.onReceiveRtp.subscribe((rtp) => {
        try { videoSock.send(rtp.serialize(), localRtpPort, "127.0.0.1"); } catch (_) {}
      });
    } else if (track.kind === "audio" && audioSock) {
      track.onReceiveRtp.subscribe((rtp) => {
        try { audioSock.send(rtp.serialize(), localAudioRtpPort, "127.0.0.1"); } catch (_) {}
      });
    }
  });

  const ws = new WebSocket(signalingUrl);

  const negotiated = new Promise((resolve, reject) => {
    const onMsg = async (raw) => {
      const msg = _parseSignalMessage(raw.toString());
      if (!msg) return;
      try {
        if (msg.type === "SDP_ANSWER") {
          await pc.setRemoteDescription(msg.payload);
          log("debug", "applied SDP_ANSWER");
          resolve();
        } else if (msg.type === "ICE_CANDIDATE") {
          await pc.addIceCandidate(msg.payload);
        }
      } catch (err) {
        reject(err);
      }
    };
    ws.on("message", onMsg);
    ws.once("error", reject);
    ws.once("close", (code) => {
      if (code !== 1000) reject(new Error(`signaling WS closed unexpectedly (${code})`));
    });
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`stream negotiation timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  await Promise.race([
    new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    timeout,
  ]);

  log("debug", "signaling open, sending offer");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  _sendSignal(ws, "SDP_OFFER", { type: "offer", sdp: pc.localDescription.sdp });

  pc.onIceCandidate.subscribe((c) => {
    if (c?.candidate) _sendSignal(ws, "ICE_CANDIDATE", c);
  });

  await Promise.race([negotiated, timeout]);
  log("debug", "WebRTC negotiation complete — forwarding RTP");

  const stop = () => {
    log("debug", "stopping RTP forwarding");
    try { ws.close(); } catch (_) {}
    try { pc.close(); } catch (_) {}
    try { videoSock.close(); } catch (_) {}
    try { audioSock?.close(); } catch (_) {}
  };

  return { stop };
}

module.exports = {
  captureStreamFrame,
  startRtpForwarding,
  pickFreeUdpPort,
  writeSdpFile,
  writeAudioSdpFile,
  resolveFfmpegPath,
  localIpAddress,
};
