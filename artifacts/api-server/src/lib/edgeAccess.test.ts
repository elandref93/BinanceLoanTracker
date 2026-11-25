import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { Request } from "express";

import {
  attestationMac,
  clientCertificateAllowed,
  describeEdgeClient,
  evaluateEdgeAccess,
  isAllowedClientIp,
  normalizeIp,
  requestMayPassEdge,
} from "./edgeAccess";

function request(partial: { ip?: string; header?: string; headers?: Record<string, string> }): Request {
  const headers: Record<string, string> = { ...(partial.headers ?? {}) };
  if (partial.header) headers["x-arr-clientcert"] = partial.header;
  return {
    ip: partial.ip,
    socket: { remoteAddress: partial.ip },
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Request;
}

function opensslBin(): string {
  if (process.platform === "win32") return "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
  return "openssl";
}

function openssl(args: string[], encoding?: "buffer"): Buffer;
function openssl(args: string[], encoding: "utf8"): string;
function openssl(args: string[], encoding: "buffer" | "utf8" = "buffer"): Buffer | string {
  return execFileSync(opensslBin(), args, { encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function conf(dir: string, fileName: string, ca: boolean): string {
  const cn = ca ? "Ledger Test CA" : "Ledger test phone";
  const basic = ca ? "critical,CA:true" : "critical,CA:false";
  const usage = ca ? "critical,keyCertSign,cRLSign" : "critical,digitalSignature";
  const eku = ca ? "" : "extendedKeyUsage=critical,clientAuth\n";
  const file = path.join(dir, fileName);
  writeFileSync(
    file,
    `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${cn}\n[ext]\nbasicConstraints=${basic}\nkeyUsage=${usage}\n${eku}`,
  );
  return file;
}

function issueFixture(dir: string): {
  caPem: string;
  caEscaped: string;
  leafB64: string;
  leafPemEscaped: string;
  expiredB64: string;
  serial: string;
} {
  const caCnf = conf(dir, "ca.cnf", true);
  const leafCnf = conf(dir, "leaf.cnf", false);
  openssl(["genrsa", "-out", path.join(dir, "ca.key"), "2048"]);
  openssl([
    "req", "-new", "-x509", "-key", path.join(dir, "ca.key"),
    "-out", path.join(dir, "ca.crt"), "-days", "30",
    "-config", caCnf, "-extensions", "ext",
  ]);
  openssl(["genrsa", "-out", path.join(dir, "leaf.key"), "2048"]);
  openssl([
    "req", "-new", "-key", path.join(dir, "leaf.key"),
    "-out", path.join(dir, "leaf.csr"), "-config", leafCnf,
  ]);
  openssl([
    "x509", "-req", "-in", path.join(dir, "leaf.csr"),
    "-CA", path.join(dir, "ca.crt"), "-CAkey", path.join(dir, "ca.key"),
    "-CAcreateserial", "-out", path.join(dir, "leaf.crt"), "-days", "30",
    "-extfile", leafCnf, "-extensions", "ext",
  ]);
  openssl([
    "x509", "-req", "-in", path.join(dir, "leaf.csr"),
    "-CA", path.join(dir, "ca.crt"), "-CAkey", path.join(dir, "ca.key"),
    "-CAcreateserial", "-out", path.join(dir, "old.crt"),
    "-not_before", "20200101000000Z", "-not_after", "20200102000000Z",
    "-extfile", leafCnf, "-extensions", "ext",
  ]);
  const caPem = readFileSync(path.join(dir, "ca.crt"), "utf8");
  const leafPem = readFileSync(path.join(dir, "leaf.crt"), "utf8");
  const leafB64 = openssl(["x509", "-in", path.join(dir, "leaf.crt"), "-outform", "DER"]).toString("base64");
  const expiredB64 = openssl(["x509", "-in", path.join(dir, "old.crt"), "-outform", "DER"]).toString("base64");
  const serialLine = openssl(["x509", "-in", path.join(dir, "leaf.crt"), "-noout", "-serial"], "utf8");
  const serial = serialLine.trim().replace(/^serial=/i, "");
  return {
    caPem,
    caEscaped: caPem.trim().replace(/\r?\n/g, "\\n"),
    leafB64,
    leafPemEscaped: leafPem.trim().replace(/\r?\n/g, "\\n"),
    expiredB64,
    serial,
  };
}

const fixtureDir = mkdtempSync(path.join(tmpdir(), "ledger-edge-"));
const issued = issueFixture(fixtureDir);
const proxySecret = "test-proxy-secret-0123456789abcdef";

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("isAllowedClientIp", () => {
  it("isAllowedClientIp_listedAddress_allowsMappedIpv4", () => {
    const env = { ALLOWED_CLIENT_IPS: "102.65.11.235, 102.36.24.176" };
    assert.equal(isAllowedClientIp("::ffff:102.65.11.235", env), true);
    assert.equal(isAllowedClientIp("102.36.24.176", env), true);
    assert.equal(isAllowedClientIp("102.36.24.176:58512", env), true);
    assert.equal(isAllowedClientIp("::ffff:102.65.11.235:443", env), true);
    assert.equal(isAllowedClientIp("8.8.8.8:1234", env), false);
    assert.equal(isAllowedClientIp("8.8.8.8", env), false);
    assert.equal(isAllowedClientIp("", env), false);
    assert.equal(normalizeIp("[2001:db8::10]:443"), "2001:db8::10");
  });
});

describe("requestMayPassEdge", () => {
  it("requestMayPassEdge_unknownIpWithoutCert_refuses", () => {
    const env = { ALLOWED_CLIENT_IPS: "102.65.11.235", WEBSITE_SITE_NAME: "ledger" };
    assert.equal(requestMayPassEdge(request({ ip: "203.0.113.9" }), env), false);
    assert.equal(requestMayPassEdge(request({ ip: "102.65.11.235" }), env), true);
    assert.equal(requestMayPassEdge(request({ ip: "102.65.11.235:58512" }), env), true);
  });

  it("requestMayPassEdge_headerOffAzure_isNotTrusted", () => {
    const env = {
      ALLOWED_CLIENT_IPS: "102.65.11.235",
      EDGE_CLIENT_CA_PEM: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    };
    assert.equal(
      clientCertificateAllowed(
        request({ ip: "203.0.113.9", header: Buffer.from("not-a-cert").toString("base64") }),
        env,
      ),
      false,
    );
  });
});

describe("clientCertificateAllowed", () => {
  const env = {
    ALLOWED_CLIENT_IPS: "102.65.11.235",
    WEBSITE_SITE_NAME: "ledger",
    EDGE_CLIENT_CA_PEM: issued.caEscaped,
  };

  it("clientCertificateAllowed_escapedCaAndBase64Der_allows", () => {
    const decision = evaluateEdgeAccess(
      request({ ip: "203.0.113.9", header: issued.leafB64 }),
      env,
    );
    assert.equal(decision.ipAllowed, false);
    assert.equal(decision.certAllowed, true);
    assert.equal(decision.clientCertPresent, true);
    assert.equal(decision.allowed, true);
    assert.equal(decision.clientIp, "203.0.113.9");
  });

  it("clientCertificateAllowed_urlEncodedAndPemHeader_allows", () => {
    assert.equal(
      clientCertificateAllowed(
        request({ ip: "203.0.113.9", header: encodeURIComponent(issued.leafB64) }),
        env,
      ),
      true,
    );
    assert.equal(
      clientCertificateAllowed(
        request({ ip: "203.0.113.9", header: issued.leafPemEscaped }),
        env,
      ),
      true,
    );
    const spaced = issued.leafB64.replace(/\+/g, " ");
    assert.equal(
      clientCertificateAllowed(request({ ip: "203.0.113.9", header: spaced }), env),
      true,
    );
  });

  it("clientCertificateAllowed_expiredOrRevoked_refuses", () => {
    assert.equal(
      clientCertificateAllowed(request({ ip: "203.0.113.9", header: issued.expiredB64 }), env),
      false,
    );
    const colonSerial = issued.serial.match(/.{1,2}/g)?.join(":") ?? issued.serial;
    const revoked = evaluateEdgeAccess(request({ ip: "203.0.113.9", header: issued.leafB64 }), {
      ...env,
      EDGE_REVOKED_CERT_SERIALS: colonSerial,
    });
    assert.equal(revoked.clientCertPresent, true);
    assert.equal(revoked.certAllowed, false);
    assert.equal(revoked.allowed, false);
  });

  it("evaluateEdgeAccess_allowedIpWithoutCert_keepsCertFalse", () => {
    const decision = evaluateEdgeAccess(request({ ip: "102.65.11.235:58512" }), env);
    assert.equal(decision.ipAllowed, true);
    assert.equal(decision.certAllowed, false);
    assert.equal(decision.clientCertPresent, false);
    assert.equal(decision.allowed, true);
    assert.equal(decision.clientIp, "102.65.11.235");
  });

  it("evaluateEdgeAccess_proxyAttestation_usesPhoneIpAndCert", () => {
    const attestedIp = "102.65.11.235";
    const mac = attestationMac(proxySecret, attestedIp, issued.leafB64);
    const decision = evaluateEdgeAccess(
      request({
        ip: "20.1.1.1",
        headers: {
          "x-ledger-client-ip": attestedIp,
          "x-ledger-client-cert": issued.leafB64,
          "x-ledger-cert-mac": mac,
        },
      }),
      { ...env, EDGE_CERT_PROXY_SECRET: proxySecret, WEBSITE_SITE_NAME: "" },
    );
    assert.equal(decision.clientIp, "102.65.11.235");
    assert.equal(decision.ipAllowed, true);
    assert.equal(decision.certAllowed, true);
    assert.equal(decision.allowed, true);
  });

  it("evaluateEdgeAccess_badProxyMac_isIgnored", () => {
    const decision = evaluateEdgeAccess(
      request({
        ip: "203.0.113.9",
        headers: {
          "x-ledger-client-ip": "102.36.24.176",
          "x-ledger-client-cert": issued.leafB64,
          "x-ledger-cert-mac": "ab".repeat(32),
        },
      }),
      { ...env, EDGE_CERT_PROXY_SECRET: proxySecret, WEBSITE_SITE_NAME: "" },
    );
    assert.equal(decision.clientIp, "203.0.113.9");
    assert.equal(decision.ipAllowed, false);
    assert.equal(decision.certAllowed, false);
    assert.equal(decision.clientCertPresent, false);
    assert.equal(decision.allowed, false);
  });

  it("evaluateEdgeAccess_badProxyMac_stillHonoursAzureHeader", () => {
    const decision = evaluateEdgeAccess(
      request({
        ip: "203.0.113.9",
        header: issued.leafB64,
        headers: {
          "x-ledger-client-ip": "102.36.24.176",
          "x-ledger-cert-mac": "ab".repeat(32),
        },
      }),
      { ...env, EDGE_CERT_PROXY_SECRET: proxySecret },
    );
    assert.equal(decision.clientIp, "203.0.113.9");
    assert.equal(decision.ipAllowed, false);
    assert.equal(decision.certAllowed, true);
    assert.equal(decision.allowed, true);
  });
});

describe("describeEdgeClient", () => {
  it("describeEdgeClient_forwardedChain_reportsIpHopsAndCertPresence", () => {
    const viewed = describeEdgeClient({
      ip: "::ffff:169.254.129.1",
      socket: { remoteAddress: "::ffff:169.254.129.1" },
      headers: {
        "x-forwarded-for": "102.36.24.176, 169.254.254.1",
        "x-arr-clientcert": "present-but-not-logged",
      },
    } as unknown as Request);
    assert.equal(viewed.clientIp, "169.254.129.1");
    assert.equal(viewed.socketIp, "169.254.129.1");
    assert.equal(viewed.forwardedHops, 2);
    assert.deepEqual(viewed.forwardedIps, ["102.36.24.176", "169.254.254.1"]);
    assert.equal(viewed.clientCertPresent, true);
    assert.equal(JSON.stringify(viewed).includes("present-but-not-logged"), false);
  });
});
