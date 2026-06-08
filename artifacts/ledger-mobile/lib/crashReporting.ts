/**
 * Crash & error capture for the Ledger app.
 *
 * We can't reach Azure or TestFlight logs from the dev environment and a real
 * Sentry/Bugsnag backend isn't wired up, so this module captures errors ON THE
 * DEVICE:
 *   - a global JS error handler for fatal uncaught exceptions,
 *   - unhandled promise rejections (where the runtime exposes the hook),
 *   - anything the React error boundary catches (via `reportFatal`).
 *
 * Each entry goes into a small ring buffer persisted to AsyncStorage so it
 * SURVIVES the crash and can be read on the next launch from the in-app
 * Diagnostics screen (Settings → Diagnostics → Crash logs). Entries are also
 * POSTed to the backend best-effort so they land in the server log stream.
 *
 * Every path here is defensive: the reporter must NEVER throw, or it could
 * itself become the crash.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { loadStoredSession } from "@/lib/session";
import { Sentry } from "@/lib/sentry";

type SentryLevel = "fatal" | "error" | "info";

// Forward a report into Sentry's cloud dashboard alongside the on-device ring
// buffer. Must never throw.
function captureToSentry(
  err: unknown,
  context: Record<string, unknown> | undefined,
  level: SentryLevel,
): void {
  try {
    const error =
      err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : JSON.stringify(err));
    Sentry.captureException(error, {
      level,
      extra: context,
    });
  } catch {
    // never throw from the reporter
  }
}

const STORAGE_KEY = "ledger.crashes.v1";
const MAX_ENTRIES = 25;

/**
 * Severity of a captured entry. `info` covers routine lifecycle markers
 * (e.g. "[session] hydrate start") logged via `reportMessage` — these are NOT
 * errors and must be labelled as such in the Diagnostics screen. `error` and
 * `fatal` are real problems.
 */
export type CrashLevel = "info" | "error" | "fatal";

export interface CrashEntry {
  id: string;
  /** ISO timestamp. */
  time: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  level: CrashLevel;
  /**
   * @deprecated Use `level`. Retained for backward compatibility with entries
   * persisted before `level` existed; always equals `level === "fatal"`.
   */
  fatal: boolean;
}

/**
 * Normalise an entry that may have been persisted before `level` existed.
 * Old entries only carried `fatal`; treat a non-fatal legacy entry as `error`
 * (we can no longer distinguish legacy info markers from real errors).
 */
function withLevel(entry: CrashEntry): CrashEntry {
  if (entry.level) return entry;
  return { ...entry, level: entry.fatal ? "fatal" : "error" };
}

// Minimal typing for React Native's global error hook (avoids depending on an
// ambient `ErrorUtils` declaration that may not exist in this tsconfig).
type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
}

let buffer: CrashEntry[] = [];
let loadPromise: Promise<void> | null = null;
let initialised = false;

// A single shared load promise so concurrent callers don't race and clobber
// previously-persisted entries with an empty buffer.
function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            buffer = (parsed as CrashEntry[]).slice(-MAX_ENTRIES).map(withLevel);
          }
        }
      } catch {
        buffer = [];
      }
    })();
  }
  return loadPromise;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // Storage is best-effort; never let logging crash the app.
  }
}

function toMessageAndStack(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || "Error", stack: err.stack };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

async function postToBackend(entry: CrashEntry): Promise<void> {
  try {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;
    const session = await loadStoredSession();
    if (!session) return;
    await fetch(`https://${domain}/api/diag/crash`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    // Offline / endpoint not deployed yet — the local copy on the Diagnostics
    // screen remains the source of truth.
  }
}

// Serializes buffer mutation + persistence so concurrent reports can't
// interleave and roll back to an older snapshot (last-finish-wins).
let writeChain: Promise<void> = Promise.resolve();
function enqueueWrite(work: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(work, work);
  return writeChain;
}

async function store(entry: CrashEntry): Promise<void> {
  await enqueueWrite(async () => {
    try {
      await ensureLoaded();
      buffer.push(entry);
      if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
      await persist();
    } catch {
      // never throw from the reporter
    }
  });
  // Network delivery is independent of local persistence ordering.
  void postToBackend(entry);
}

function makeEntry(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown> | undefined,
  level: CrashLevel,
): CrashEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    message,
    stack,
    context,
    level,
    fatal: level === "fatal",
  };
}

export function reportError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  try {
    const { message, stack } = toMessageAndStack(err);
    // eslint-disable-next-line no-console
    console.error("[crashReporting]", message, context ?? {});
    void store(makeEntry(message, stack, context, "error"));
    captureToSentry(err, context, "error");
  } catch {
    // never throw
  }
}

export function reportFatal(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  try {
    const { message, stack } = toMessageAndStack(err);
    // eslint-disable-next-line no-console
    console.error("[crashReporting][FATAL]", message, context ?? {});
    void store(makeEntry(message, stack, context, "fatal"));
    captureToSentry(err, context, "fatal");
  } catch {
    // never throw
  }
}

export function reportMessage(
  message: string,
  context?: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line no-console
    console.warn("[crashReporting]", message, context ?? {});
    void store(makeEntry(message, undefined, context, "info"));
    try {
      // Record as a breadcrumb, NOT a captured message. These are routine
      // lifecycle markers ("[session] hydrate start", "[sync] accounts push
      // skipped", ...); capturing them created a standalone Sentry *issue* per
      // marker, flooding the dashboard with non-actionable info noise. As
      // breadcrumbs they still travel with the next real error/crash to give a
      // trail, and the on-device buffer + backend POST above are unchanged.
      Sentry.addBreadcrumb({
        level: "info",
        message,
        data: context,
      });
    } catch {
      // never throw from the reporter
    }
  } catch {
    // never throw
  }
}

/** Newest-first list for the Diagnostics screen. */
export async function getRecentCrashes(): Promise<CrashEntry[]> {
  await ensureLoaded();
  return [...buffer].reverse();
}

export async function clearCrashes(): Promise<void> {
  await enqueueWrite(async () => {
    buffer = [];
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  });
}

export function initCrashReporting(): void {
  if (initialised) return;
  initialised = true;

  // Load any entries persisted from a previous (possibly crashed) session.
  void ensureLoaded();

  // 1. Fatal uncaught JS exceptions via React Native's global handler.
  try {
    const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike })
      .ErrorUtils;
    if (eu?.setGlobalHandler) {
      const prev = eu.getGlobalHandler?.();
      eu.setGlobalHandler((error, isFatal) => {
        const { message, stack } = toMessageAndStack(error);
        void store(
          makeEntry(
            message,
            stack,
            { source: "globalHandler" },
            (isFatal ?? true) ? "fatal" : "error",
          ),
        );
        // Preserve default behaviour (redbox in dev / crash in prod) so we
        // never silently swallow a fatal error.
        prev?.(error, isFatal);
      });
    }
  } catch {
    // ignore
  }

  // 2. Unhandled promise rejections. RN/Hermes is inconsistent about which
  //    hook is present, so register both the listener and assignment forms.
  const onRejection = (e: unknown): void => {
    const reason = (e as { reason?: unknown })?.reason ?? e;
    const { message, stack } = toMessageAndStack(reason);
    void store(
      makeEntry(message, stack, { source: "unhandledrejection" }, "error"),
    );
  };
  try {
    const g = globalThis as unknown as {
      addEventListener?: (type: string, cb: (e: unknown) => void) => void;
      onunhandledrejection?: (e: unknown) => void;
    };
    g.addEventListener?.("unhandledrejection", onRejection);
    try {
      g.onunhandledrejection = onRejection;
    } catch {
      // assignment unsupported — the listener form above still applies
    }
  } catch {
    // ignore
  }
}
