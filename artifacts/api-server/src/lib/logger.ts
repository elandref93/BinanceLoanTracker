import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { captureLogEvent } from "./sentry";

// Header names that carry session tokens or exchange credentials. Node
// lowercases incoming headers; the mixed-case forms cover objects built by
// hand (outbound Binance `X-MBX-APIKEY`, raw `Set-Cookie`).
const SENSITIVE_HEADER_NAMES = [
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "Set-Cookie",
  "x-binance-accounts",
  "X-Binance-Accounts",
  "x-luno-accounts",
  "X-Luno-Accounts",
  "x-mbx-apikey",
  "X-MBX-APIKEY",
] as const;

function headerLeaf(name: string): string {
  return name.includes("-") ? `["${name}"]` : name;
}

function sensitiveHeaderPaths(): string[] {
  const prefixes = [
    "headers",
    "req.headers",
    "res.headers",
    "request.headers",
    "response.headers",
    "*.headers",
    "*.*.headers",
    "*.*.*.headers",
  ];
  const paths: string[] = [];
  for (const prefix of prefixes) {
    for (const name of SENSITIVE_HEADER_NAMES) {
      paths.push(`${prefix}.${headerLeaf(name)}`);
    }
  }
  return paths;
}

const SECRET_BODY_PATHS = [
  "apiKey",
  "apiSecret",
  "keySecret",
  "*.apiKey",
  "*.apiSecret",
  "*.keySecret",
  "*.*.apiKey",
  "*.*.apiSecret",
  "*.*.keySecret",
  "*.*.*.apiKey",
  "*.*.*.apiSecret",
  "*.*.*.keySecret",
];

export const logRedact: NonNullable<LoggerOptions["redact"]> = {
  paths: [...sensitiveHeaderPaths(), ...SECRET_BODY_PATHS],
  censor: "[Redacted]",
};

/** Last six characters only. Logs must not carry a full profile id. */
export function logSubject(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (id.length <= 6) return "set";
  return id.slice(-6);
}

/**
 * Access-log shape for pino-http. Drops headers, cookies, and the query
 * string so a logged request cannot carry a bearer token, an exchange-account
 * header, or a secret in the URL. `logRedact` is the second line of defense
 * when a route logs a header bag directly.
 */
export const httpLogSerializers = {
  req(req: { id?: unknown; method?: unknown; url?: unknown }) {
    const rawUrl = typeof req.url === "string" ? req.url : undefined;
    return {
      id: req.id,
      method: req.method,
      url: rawUrl?.split("?")[0],
    };
  },
  res(res: { statusCode?: unknown }) {
    return {
      statusCode: res.statusCode,
    };
  },
};

export function createLogger(destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? "info",
    redact: logRedact,
  };
  if (destination) return pino(options, destination);
  if (process.env.NODE_ENV === "production") {
    // Mirror error/fatal logs into Sentry so that handled-and-swallowed
    // failures (not just unhandled crashes) reach the dashboard. Gated to
    // production so local dev errors never pollute the shared Sentry project.
    options.hooks = {
      logMethod(inputArgs, method, level) {
        if (level >= 50) captureLogEvent(level, inputArgs);
        return method.apply(this, inputArgs);
      },
    };
    return pino(options);
  }
  options.transport = {
    target: "pino-pretty",
    options: { colorize: true },
  };
  return pino(options);
}

export const logger = createLogger();
