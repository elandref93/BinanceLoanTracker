import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DIRECTORY_URL = process.env.ACME_DIRECTORY ?? "https://acme-v02.api.letsencrypt.org/directory";

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function publicJwk(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
}

function thumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64url(crypto.createHash("sha256").update(canonical).digest());
}

async function readDirectory() {
  const response = await fetch(DIRECTORY_URL);
  if (!response.ok) throw new Error(`acme directory ${response.status}`);
  return response.json();
}

async function freshNonce(directory) {
  const head = await fetch(directory.newNonce, { method: "HEAD" });
  const nonce = head.headers.get("replay-nonce");
  if (nonce) return nonce;
  const get = await fetch(directory.newNonce, { method: "GET" });
  const fallback = get.headers.get("replay-nonce");
  if (!fallback) throw new Error("acme nonce missing");
  return fallback;
}

async function signedPost(url, payload, { accountKey, jwk, kid, nonce }) {
  const protectedHeader = { alg: "ES256", nonce, url };
  if (kid) protectedHeader.kid = kid;
  else protectedHeader.jwk = jwk;
  const encodedHeader = b64url(JSON.stringify(protectedHeader));
  const encodedPayload = payload === null ? "" : b64url(JSON.stringify(payload));
  const signature = crypto.sign("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`), {
    key: accountKey,
    dsaEncoding: "ieee-p1363",
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/jose+json" },
    body: JSON.stringify({
      protected: encodedHeader,
      payload: encodedPayload,
      signature: b64url(signature),
    }),
  });
  const nextNonce = response.headers.get("replay-nonce") || nonce;
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  let body = null;
  if (type.includes("json") || text.startsWith("{")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { detail: text.slice(0, 180) };
    }
  }
  return { response, body, text, nextNonce };
}

async function post(url, payload, state) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await signedPost(url, payload, state);
    state.nonce = result.nextNonce;
    const badNonce = result.body?.type === "urn:ietf:params:acme:error:badNonce";
    if (result.response.ok) return result;
    if (badNonce && attempt === 0) {
      state.nonce = await freshNonce(state.directory);
      continue;
    }
    const detail = typeof result.body?.detail === "string" ? result.body.detail : result.response.status;
    throw new Error(`acme ${result.response.status} ${String(detail).slice(0, 240)}`);
  }
  throw new Error("acme request failed");
}

function serverKeyAndCsr(hostnames) {
  if (hostnames.length === 0) throw new Error("edge hostname list is empty");
  for (const hostname of hostnames) {
    if (!/^[a-z0-9.-]+$/.test(hostname)) throw new Error("edge hostname is not a dns name");
  }
  const dir = mkdtempSync(path.join(tmpdir(), "edge-csr-"));
  try {
    const keyPath = path.join(dir, "key.pem");
    const csrPath = path.join(dir, "csr.der");
    execFileSync("openssl", ["genrsa", "-out", keyPath, "2048"], { stdio: ["ignore", "pipe", "pipe"] });
    execFileSync(
      "openssl",
      [
        "req", "-new", "-key", keyPath,
        "-subj", `/CN=${hostnames[0]}`,
        "-addext", `subjectAltName=${hostnames.map((name) => `DNS:${name}`).join(",")}`,
        "-outform", "DER", "-out", csrPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return {
      keyPem: readFileSync(keyPath, "utf8"),
      csrDer: readFileSync(csrPath),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function poll(url, state, ready) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await post(url, null, state);
    if (ready(result.body)) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("acme order did not complete");
}

/**
 * Issues one publicly trusted certificate covering every name in hostnames.
 * `publishChallenge(token, keyAuthorization)` must answer HTTP-01 for each
 * authorization before it returns.
 *
 * Two names, one certificate, on purpose: the edge answers on both the Azure
 * DNS label and the custom domain a restricted network resolves. Each name is
 * authorized separately, so a name whose DNS record is not in place yet fails
 * the whole order — add the record first, then restart to pick the name up.
 */
export async function issueCertificate(hostnames, publishChallenge) {
  const names = Array.isArray(hostnames) ? hostnames : [hostnames];
  if (names.length === 0) throw new Error("no hostnames to certify");
  const directory = await readDirectory();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicJwk(publicKey);
  const state = {
    directory,
    accountKey: privateKey,
    jwk,
    kid: "",
    nonce: await freshNonce(directory),
  };
  const account = await post(directory.newAccount, { termsOfServiceAgreed: true }, state);
  state.kid = account.response.headers.get("location") || "";
  if (!state.kid) throw new Error("acme account location missing");

  const order = await post(
    directory.newOrder,
    { identifiers: names.map((value) => ({ type: "dns", value })) },
    state,
  );
  const orderUrl = order.response.headers.get("location");
  if (!orderUrl) throw new Error("acme order location missing");
  const authUrls = order.body?.authorizations ?? [];
  if (authUrls.length === 0) throw new Error("acme authorization missing");

  // Every authorization must be answered before the order can be finalized.
  // A token is per-authorization, so they are published in one pass and only
  // then acknowledged.
  const challenges = [];
  for (const authUrl of authUrls) {
    const auth = await post(authUrl, null, state);
    const challenge = (auth.body?.challenges ?? []).find((item) => item.type === "http-01");
    if (!challenge?.token || !challenge.url) throw new Error("acme http-01 challenge missing");
    const keyAuthorization = `${challenge.token}.${thumbprint(jwk)}`;
    publishChallenge(challenge.token, keyAuthorization);
    challenges.push({ authUrl, challenge });
  }
  for (const { challenge } of challenges) {
    await post(challenge.url, {}, state);
  }
  for (const { authUrl } of challenges) {
    await poll(authUrl, state, (body) => body?.status === "valid");
  }
  const ready = await poll(orderUrl, state, (body) => body?.status === "ready" || body?.status === "valid");
  const { keyPem, csrDer } = serverKeyAndCsr(names);
  if (ready.status !== "valid") {
    const finalize = ready.finalize;
    if (!finalize) throw new Error("acme finalize url missing");
    await post(finalize, { csr: b64url(csrDer) }, state);
  }
  const done = await poll(orderUrl, state, (body) => body?.status === "valid" && body.certificate);
  const downloaded = await signedPost(done.certificate, null, state);
  state.nonce = downloaded.nextNonce;
  if (!downloaded.response.ok) throw new Error(`acme certificate ${downloaded.response.status}`);
  const certPem = downloaded.text;
  if (!certPem.includes("BEGIN CERTIFICATE")) throw new Error("acme certificate missing");
  return { certPem, keyPem };
}
