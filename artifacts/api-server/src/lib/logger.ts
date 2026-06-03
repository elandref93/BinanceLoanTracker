import pino from "pino";

import { captureLogEvent } from "./sentry";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {
        // Mirror error/fatal logs into Sentry so that handled-and-swallowed
        // failures (not just unhandled crashes) reach the dashboard. Gated to
        // production so local dev errors never pollute the shared Sentry project.
        hooks: {
          logMethod(inputArgs, method, level) {
            if (level >= 50) captureLogEvent(level, inputArgs);
            return method.apply(this, inputArgs);
          },
        },
      }
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
