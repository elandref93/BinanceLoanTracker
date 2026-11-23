/**
 * Issues one client certificate for the iPhone and one for the iPad.
 * Writes only under secrets/access/, which is gitignored.
 * Prints paths, never key material.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "secrets", "access");
const devices = ["iphone", "ipad"];
const days = "825";

function opensslBin() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
      "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return "openssl";
}

const opensslExe = opensslBin();

function openssl(args) {
  execFileSync(opensslExe, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function configFor(name, ca) {
  const cn = ca ? "Ledger Device CA" : `Ledger ${name}`;
  const basic = ca ? "critical,CA:true" : "critical,CA:false";
  const usage = ca ? "critical,keyCertSign,cRLSign" : "critical,digitalSignature,keyEncipherment";
  const extra = ca ? "" : "extendedKeyUsage=critical,clientAuth\n";
  return [
    "[req]",
    "distinguished_name=dn",
    "x509_extensions=ext",
    "prompt=no",
    "[dn]",
    `CN=${cn}`,
    "[ext]",
    `basicConstraints=${basic}`,
    `keyUsage=${usage}`,
    extra.trimEnd(),
    "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

mkdirSync(dir, { recursive: true });
const caKey = path.join(dir, "ca.key");
const caCrt = path.join(dir, "ca.crt");
const caConf = path.join(dir, "ca.cnf");
writeFileSync(caConf, configFor("ca", true));
openssl(["genrsa", "-out", caKey, "3072"]);
openssl([
  "req",
  "-new",
  "-x509",
  "-key",
  caKey,
  "-out",
  caCrt,
  "-days",
  "3650",
  "-config",
  caConf,
  "-extensions",
  "ext",
]);

const password = randomBytes(12).toString("base64url");
const passwords = ["Install each profile with this password. It is not a Ledger sign-in password.", password, ""];

for (const name of devices) {
  const key = path.join(dir, `${name}.key`);
  const csr = path.join(dir, `${name}.csr`);
  const crt = path.join(dir, `${name}.crt`);
  const p12 = path.join(dir, `${name}.p12`);
  const conf = path.join(dir, `${name}.cnf`);
  writeFileSync(conf, configFor(name, false));
  openssl(["genrsa", "-out", key, "2048"]);
  openssl(["req", "-new", "-key", key, "-out", csr, "-config", conf]);
  openssl([
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    caCrt,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    crt,
    "-days",
    days,
    "-extfile",
    conf,
    "-extensions",
    "ext",
  ]);
  openssl([
    "pkcs12",
    "-export",
    "-inkey",
    key,
    "-in",
    crt,
    "-certfile",
    caCrt,
    "-out",
    p12,
    "-passout",
    `pass:${password}`,
    "-name",
    `Ledger ${name}`,
  ]);
  const p12b64 = readFileSync(p12).toString("base64");
  const caB64 = readFileSync(caCrt).toString("base64");
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key><string>Ledger ${name}</string>
  <key>PayloadIdentifier</key><string>life.ubuntu.ledger.${name}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${cryptoRandom()}</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadIdentifier</key><string>life.ubuntu.ledger.${name}.ca</string>
      <key>PayloadUUID</key><string>${cryptoRandom()}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadDisplayName</key><string>Ledger CA</string>
      <key>PayloadCertificateFileName</key><string>ca.crt</string>
      <key>PayloadContent</key><data>${caB64}</data>
    </dict>
    <dict>
      <key>PayloadType</key><string>com.apple.security.pkcs12</string>
      <key>PayloadIdentifier</key><string>life.ubuntu.ledger.${name}.p12</string>
      <key>PayloadUUID</key><string>${cryptoRandom()}</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadDisplayName</key><string>Ledger ${name}</string>
      <key>PayloadCertificateFileName</key><string>${name}.p12</string>
      <key>Password</key><string>${password}</string>
      <key>PayloadContent</key><data>${p12b64}</data>
    </dict>
  </array>
</dict>
</plist>
`;
  writeFileSync(path.join(dir, `${name}.mobileconfig`), profile);
  passwords.push(`${name} serial: ${serialOf(crt)}`);
}

writeFileSync(path.join(dir, "install.txt"), passwords.join("\n"));
process.stdout.write(`wrote ${dir}\n`);

function cryptoRandom() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function serialOf(crt) {
  const text = execFileSync(opensslExe, ["x509", "-in", crt, "-noout", "-serial"], { encoding: "utf8" });
  return text.trim().replace(/^serial=/i, "").toLowerCase();
}
