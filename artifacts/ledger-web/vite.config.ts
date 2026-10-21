import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort ?? ""}"`);
}

/** Optional LAN HTTPS. Unset env keeps the usual HTTP dev server. */
function readDevHttps(): { key: Buffer; cert: Buffer } | undefined {
  const keyPath = process.env.LEDGER_DEV_HTTPS_KEY?.trim() ?? "";
  const certPath = process.env.LEDGER_DEV_HTTPS_CERT?.trim() ?? "";
  if (keyPath.length === 0 || certPath.length === 0) return undefined;
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

const devHttps = readDevHttps();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port,
    host: "0.0.0.0",
    strictPort: true,
    ...(devHttps ? { https: devHttps, allowedHosts: true } : {}),
    // Same-origin /api so the __Host- session cookie is first-party. Cross-site
    // cookies (this dev server calling azurewebsites.net directly) fail in
    // Safari. Production must proxy /api on the same host. Do not set a
    // Domain attribute on the session cookie.
    proxy: {
      "/api": {
        target: process.env.LEDGER_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    strictPort: true,
  },
});
