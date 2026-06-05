#!/usr/bin/env node
"use strict";

/**
 * parse-pcap.js — feed a tcpdump/Wireshark capture into the JS GUTES
 * parser to validate the protocol layer against real device traffic.
 *
 * USAGE
 *
 *   1. Capture GUTES traffic from your network (run this on a host that
 *      can see your doorbell — e.g. your homebridge box, or a laptop on
 *      the same VLAN). Replace en0 with your interface and adjust the
 *      filter for whatever ports Wyze devices end up using on your LAN.
 *
 *        sudo tcpdump -i en0 -w /tmp/gutes.pcap \
 *          'udp and (port 8800 or port 32100 or src host <doorbell-ip>)'
 *
 *      Let it run for ~30s while the doorbell is online (or doing
 *      something — a press, motion, etc.). Stop with Ctrl+C.
 *
 *   2. Run the parser:
 *
 *        node parse-pcap.js /tmp/gutes.pcap
 *
 *   3. Read the summary. Each detected GUTES frame is printed with its
 *      type, term_id (decrypted), and encryption mode. Frames that
 *      didn't parse cleanly print "(skip)" — these are usually
 *      non-GUTES UDP packets caught by the filter.
 *
 * WHAT THIS PROVES
 *
 *   - JS RC5, frame parser, and crypto helpers handle real-world bytes
 *   - We can identify GUTES frame types and decrypt headers
 *   - The decoded term_id matches what cryze would log for the same
 *     pcap (compare side-by-side if cryze is set up)
 *
 * WHAT THIS DOESN'T PROVE
 *
 *   - We can't yet *originate* sessions or decrypt session-encrypted
 *     payloads without the CERTIFY exchange. That's the next phase.
 */

const fs = require("fs");
const path = require("path");
const { parseFrame, readFrameFromStream } = require("../../src/gutes/lib/frame");
const { frameTypeName, PROTOCOL } = require("../../src/gutes/lib/constants");

// ---- Minimal pcap reader ------------------------------------------------
//
// We only need to walk records and extract the UDP payload of each one.
// Standard libpcap format — magic number + global header, then a series
// of per-packet records with their own header + raw link-layer data.

const PCAP_MAGIC_LE = 0xA1B2C3D4;
const PCAP_MAGIC_BE = 0xD4C3B2A1;
const PCAP_MAGIC_NS_LE = 0xA1B23C4D;  // nanosecond timestamp variant
const PCAP_MAGIC_NS_BE = 0x4D3CB2A1;
const PCAPNG_BLOCK_TYPE_SHB = 0x0A0D0D0A; // pcapng section header block

function readPcap(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 24) throw new Error("file too short to be a pcap");

  const magic = buf.readUInt32LE(0);

  // pcapng support: detect but reject. Wireshark defaults to pcapng now,
  // so users may save in that format. We tell them to re-save as .pcap.
  if (magic === PCAPNG_BLOCK_TYPE_SHB) {
    throw new Error(
      "pcapng format detected. Re-save in classic pcap format:\n" +
      "  tshark -r in.pcapng -w out.pcap -F libpcap\n" +
      "or:\n" +
      "  editcap -F libpcap in.pcapng out.pcap"
    );
  }

  let bigEndian = false;
  let nanoTimestamps = false;
  if (magic === PCAP_MAGIC_LE) {
    bigEndian = false;
  } else if (magic === PCAP_MAGIC_BE) {
    bigEndian = true;
  } else if (magic === PCAP_MAGIC_NS_LE) {
    nanoTimestamps = true;
  } else if (magic === PCAP_MAGIC_NS_BE) {
    bigEndian = true;
    nanoTimestamps = true;
  } else {
    throw new Error(`unrecognized pcap magic 0x${magic.toString(16).padStart(8, "0")}`);
  }

  // Global header is 24 bytes: magic(4) version(4) thiszone(4) sigfigs(4)
  // snaplen(4) network(4). We need linktype to skip the L2 header per packet.
  const u32 = (off) => bigEndian ? buf.readUInt32BE(off) : buf.readUInt32LE(off);
  const u16 = (off) => bigEndian ? buf.readUInt16BE(off) : buf.readUInt16LE(off);
  const linktype = u32(20);

  const packets = [];
  let off = 24;
  while (off + 16 <= buf.length) {
    // Per-packet record header: ts_sec(4) ts_usec(4) incl_len(4) orig_len(4)
    const inclLen = u32(off + 8);
    if (inclLen > buf.length - off - 16) break; // truncated
    const data = buf.subarray(off + 16, off + 16 + inclLen);
    packets.push({ data, linktype });
    off += 16 + inclLen;
  }
  return { packets, linktype, bigEndian, nanoTimestamps };
}

// ---- L2 / L3 / L4 skip helpers -----------------------------------------
//
// We only support the link-layer types we're likely to encounter:
//   1   = LINKTYPE_ETHERNET (Ethernet II)
//   101 = LINKTYPE_RAW (raw IPv4/IPv6 — no L2)
//   113 = LINKTYPE_LINUX_SLL (Linux cooked, 16-byte header)
//   276 = LINKTYPE_LINUX_SLL2 (newer cooked, 20-byte header)
//   141 = LINKTYPE_MTP2_WITH_PHDR (uncommon)
//
// For unknowns, we skip the packet rather than guess.

function extractUdpPayload(packet) {
  const data = packet.data;
  let p = 0;

  switch (packet.linktype) {
    case 1: {
      // Ethernet II: 14-byte header, ethertype at offset 12.
      if (data.length < 14) return null;
      const ethertype = data.readUInt16BE(12);
      if (ethertype === 0x0800) {
        p = 14; // IPv4
      } else if (ethertype === 0x86DD) {
        p = 14; // IPv6 (handled below)
        return extractFromIpv6(data, p);
      } else if (ethertype === 0x8100) {
        // 802.1Q VLAN tag — skip 4 bytes and re-read ethertype.
        if (data.length < 18) return null;
        const innerEth = data.readUInt16BE(16);
        if (innerEth !== 0x0800) return null;
        p = 18;
      } else {
        return null;
      }
      break;
    }
    case 101: p = 0; break; // raw IP
    case 113:
      // Linux cooked v1 — 16 bytes, last 2 bytes are protocol type.
      if (data.length < 16) return null;
      if (data.readUInt16BE(14) !== 0x0800) return null;
      p = 16;
      break;
    case 276:
      // Linux cooked v2 — 20 bytes, protocol type at offset 0.
      if (data.length < 20) return null;
      if (data.readUInt16BE(0) !== 0x0800) return null;
      p = 20;
      break;
    default:
      return null;
  }

  return extractFromIpv4(data, p);
}

function extractFromIpv4(data, p) {
  if (data.length < p + 20) return null;
  const versionIhl = data[p];
  if ((versionIhl >> 4) !== 4) return null;
  const ihl = (versionIhl & 0x0F) * 4;
  if (ihl < 20) return null;
  const protocol = data[p + 9];
  if (protocol !== 17) return null; // UDP
  const ipPayloadStart = p + ihl;
  if (data.length < ipPayloadStart + 8) return null; // need UDP header
  // UDP header: src(2) dst(2) len(2) cksum(2) → 8 bytes
  const udpLen = data.readUInt16BE(ipPayloadStart + 4);
  const udpPayload = data.subarray(ipPayloadStart + 8, ipPayloadStart + udpLen);
  return udpPayload;
}

function extractFromIpv6(data, p) {
  if (data.length < p + 40) return null;
  const version = data[p] >> 4;
  if (version !== 6) return null;
  const nextHeader = data[p + 6];
  if (nextHeader !== 17) return null; // UDP (no extension headers handled)
  const udpStart = p + 40;
  if (data.length < udpStart + 8) return null;
  const udpLen = data.readUInt16BE(udpStart + 4);
  const udpPayload = data.subarray(udpStart + 8, udpStart + udpLen);
  return udpPayload;
}

// ---- Main --------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error("usage: node parse-pcap.js <file.pcap> [--verbose] [--show-payload]");
    process.exit(2);
  }
  const pcapPath = argv[0];
  const verbose = argv.includes("--verbose");
  const showPayload = argv.includes("--show-payload");

  if (!fs.existsSync(pcapPath)) {
    console.error(`file not found: ${pcapPath}`);
    process.exit(1);
  }

  const { packets, linktype } = readPcap(pcapPath);
  console.log(`Loaded ${packets.length} packets (linktype=${linktype}) from ${path.basename(pcapPath)}\n`);

  const typeCounts = new Map();
  let gutesCount = 0;
  let skipped = 0;
  let nonGutes = 0;

  for (const pkt of packets) {
    const payload = extractUdpPayload(pkt);
    if (!payload || payload.length < 4) { skipped++; continue; }
    if (payload[0] !== PROTOCOL.RELAY && payload[0] !== PROTOCOL.SESSION && payload[0] !== PROTOCOL.BROADCAST) {
      nonGutes++;
      continue;
    }

    // Try as single-frame UDP first.
    const frame = parseFrame(payload, { direction: "?->?" });
    if (!frame) { skipped++; continue; }
    gutesCount++;
    typeCounts.set(frame.typeName, (typeCounts.get(frame.typeName) || 0) + 1);

    if (verbose) {
      console.log(frame.summary());
      if (showPayload && frame.payloadDecrypted) {
        const hex = frame.payloadDecrypted.subarray(0, 32).toString("hex");
        console.log(`        payload[:32]: ${hex}${frame.payloadDecrypted.length > 32 ? "..." : ""}`);
      }
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`GUTES frames:     ${gutesCount}`);
  console.log(`non-GUTES UDP:    ${nonGutes}`);
  console.log(`skipped/unparsed: ${skipped}`);
  if (typeCounts.size > 0) {
    console.log(`\nFrame type breakdown:`);
    for (const [name, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${name}`);
    }
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
