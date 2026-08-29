const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");

// Node 24.18.0+ dropped the legacy "DigiCert Global Root CA" from its bundled trust
// store (NSS 3.123.1 update), which breaks TLS to api.wyzecam.com and
// yd-saas-toc.wyzecam.com. Pin the DigiCert roots Wyze's backend depends on so trust
// no longer depends on the host's Node version.
// A custom `ca` option on an https.Agent REPLACES Node's default bundle rather than
// appending to it, so tls.rootCertificates must be included to keep every other host trusted.
const EXTRA_CA_CERTS = [
  fs.readFileSync(path.join(__dirname, "certs", "digicert-global-root-ca.pem")),
  fs.readFileSync(path.join(__dirname, "certs", "digicert-global-root-g2.pem")),
];

module.exports = new https.Agent({
  ca: [...tls.rootCertificates, ...EXTRA_CA_CERTS],
});
