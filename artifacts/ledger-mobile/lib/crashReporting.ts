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

const STORAGE_KEY = "ledger.crashes.v1";
const MAX_ENTRIES = 25;

export interface CrashEntry {
  id: string;
  /** ISO timestamp. */
  time: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  fatal: boolean;
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
            buffer = (parsed as CrashEntry[]).slice(-MAX_ENTRIES);
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
  fatal: boolean,
): CrashEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    message,
    stack,
    context,
    fatal,
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
    void store(makeEntry(message, stack, context, false));
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
    void store(makeEntry(message, stack, context, true));
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
    void store(makeEntry(message, undefined, context, false));
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
          makeEntry(message, stack, { source: "globalHandler" }, isFatal ?? true),
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
      makeEntry(message, stack, { source: "unhandledrejection" }, false),
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
