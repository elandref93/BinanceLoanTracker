import fs from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

/** Browser config injected into index.html. The API base is always this host. */
export type LedgerPublicConfig = {
  apiBaseUrl: "";
  clerkPublishableKey: string;
};

const DEFAULT_WEB_ROOT = "/app/web";

/**
 * Directory of the built dashboard. Unset uses /app/web, which is where the
 * runtime image places the Vite output. Missing index.html means API-only.
 */
export function resolveLedgerWebRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.LEDGER_WEB_ROOT?.trim() ?? "";
  const root = configured.length > 0 ? configured : DEFAULT_WEB_ROOT;
  if (!fs.existsSync(path.join(root, "index.html"))) return null;
  return root;
}

/**
 * Same-origin API. Callers cannot point the served page at another host:
 * apiBaseUrl is the empty string, which the SPA treats as `/api` on this host.
 * The Clerk publishable key is public by design and is only sent after the edge gate.
 */
export function ledgerPublicConfig(env: NodeJS.ProcessEnv = process.env): LedgerPublicConfig {
  const raw = env.CLERK_PUBLISHABLE_KEY ?? env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  return {
    apiBaseUrl: "",
    clerkPublishableKey: raw.trim(),
  };
}

export function ledgerPublicConfigScript(config: LedgerPublicConfig): string {
  const json = JSON.stringify(config).replaceAll("<", "\\u003c");
  return `window.__LEDGER_PUBLIC__=${json};`;
}

export function injectLedgerPublicConfig(html: string, config: LedgerPublicConfig): string {
  const tag = `<script>${ledgerPublicConfigScript(config)}</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose >= 0) {
    return `${html.slice(0, headClose)}${tag}${html.slice(headClose)}`;
  }
  return `${tag}${html}`;
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** True for GET/HEAD navigations and /index.html. Never for /api or asset URLs. */
export function shouldServeLedgerIndex(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (isApiPath(pathname)) return false;
  if (pathname === "/" || pathname === "/index.html") return true;
  return path.posix.extname(pathname).length === 0;
}

function sendIndex(res: Response, template: string): void {
  const html = injectLedgerPublicConfig(template, ledgerPublicConfig());
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(html);
}

/**
 * Static dashboard plus client-route fallback. Mount this only after the edge
 * gate so index.html and assets are not written to a denied response.
 */
export function mountLedgerWeb(app: Express, root: string): void {
  const template = fs.readFileSync(path.join(root, "index.html"), "utf8");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!shouldServeLedgerIndex(req.path, req.method)) {
      next();
      return;
    }
    sendIndex(res, template);
  });

  app.use(
    express.static(root, {
      index: false,
      fallthrough: true,
      redirect: false,
      dotfiles: "ignore",
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === "sw.js" || name === "index.html" || name.endsWith(".webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (isApiPath(req.path)) {
      next();
      return;
    }
    res.status(404).type("text/plain").send("Not found");
  });
}
