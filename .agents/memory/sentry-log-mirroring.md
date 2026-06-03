---
name: Backend Sentry log mirroring
description: How handled/swallowed backend errors reach Sentry, and the constraints that keep it correct.
---

# Backend Sentry log mirroring (api-server)

Handled errors that are caught, logged, and swallowed (e.g. one account's loan
fetch failing and returning `[]`) must still reach Sentry — not just unhandled
crashes. This is wired by mirroring Pino logs into Sentry, NOT by sprinkling
`captureException` everywhere.

How it works:
- `lib/logger.ts` installs a Pino `hooks.logMethod` (production only) that calls
  `captureLogEvent(level, args)` for `level >= 50` (error/fatal).
- `lib/sentry.ts#captureLogEvent` builds the Sentry event from the log args.

**Why these constraints (don't regress them):**
- **Whitelist-only fields (`SAFE_LOG_FIELDS`).** Pino's `redact` only scrubs
  Pino's own serialized output, so handing the raw log object to Sentry can leak
  headers/cookies/bodies/secrets. Only copy known-safe scalar fields plus the
  `Error`. Never add user identifiers or semi-structured payloads without review.
- **Init is gated to production** (`NODE_ENV==='production' || SENTRY_DSN`). Both
  `initSentry()` and the log-hook are gated so local dev never sends traffic to
  the shared Sentry project. Gating the hook alone is not enough — uncaught
  handlers + requestHandler would still emit; gate init too.
- **Per-Error dedupe marker** (`Symbol.for("ledger.sentry.captured")`). A helper
  often logs an error then rethrows, so the same Error is logged again by the
  final error handler. Tag the Error after first capture so it produces exactly
  one event. Sentry's built-in Dedupe is best-effort (compares only the previous
  event) and is not reliable under interleaved requests.
- **Do NOT re-add `Sentry.Handlers.errorHandler()`** in `app.ts`. The final
  error handler's `logger.error` already routes to Sentry via the hook, inside
  the `requestHandler` request scope. Adding the error middleware back
  double-captures unhandled route errors.

**How to apply:** when adding new error logging, just `logger.error({ err, ... })`
with safe fields — capture is automatic in prod. Don't bypass the logger with
direct `captureException` unless you intentionally want a non-logged event.
