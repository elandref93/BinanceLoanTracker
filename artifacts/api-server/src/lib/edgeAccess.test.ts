import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";

import { clientCertificateAllowed, isAllowedClientIp, requestMayPassEdge } from "./edgeAccess";

function request(partial: { ip?: string; header?: string }): Request {
  return {
    ip: partial.ip,
    socket: { remoteAddress: partial.ip },
    header(name: string) {
      if (name.toLowerCase() === "x-arr-clientcert") return partial.header;
      return undefined;
    },
  } as Request;
}

describe("isAllowedClientIp", () => {
  it("isAllowedClientIp_listedAddress_allowsMappedIpv4", () => {
    const env = { ALLOWED_CLIENT_IPS: "102.65.11.235, 102.36.24.176" };
    assert.equal(isAllowedClientIp("::ffff:102.65.11.235", env), true);
    assert.equal(isAllowedClientIp("102.36.24.176", env), true);
    assert.equal(isAllowedClientIp("8.8.8.8", env), false);
    assert.equal(isAllowedClientIp("", env), false);
  });
});

describe("requestMayPassEdge", () => {
  it("requestMayPassEdge_unknownIpWithoutCert_refuses", () => {
    const env = { ALLOWED_CLIENT_IPS: "102.65.11.235", WEBSITE_SITE_NAME: "ledger" };
    assert.equal(requestMayPassEdge(request({ ip: "203.0.113.9" }), env), false);
    assert.equal(requestMayPassEdge(request({ ip: "102.65.11.235" }), env), true);
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
