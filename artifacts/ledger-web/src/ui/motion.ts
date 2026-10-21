import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Shared easing so every moving element settles the same way. */
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a number into an element's textContent without re-rendering React
 * on every frame. The first value rolls up from zero; later values roll from
 * the previous one. Reduced motion writes the final text immediately.
 */
export function useRollingNumber(
  ref: RefObject<HTMLElement | null>,
  value: number | null,
  format: (n: number) => string,
  durationMs = 700,
): void {
  const previous = useRef<number | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (value == null || !Number.isFinite(value)) {
      node.textContent = "—";
      previous.current = null;
      return;
    }
    const from = previous.current ?? 0;
    previous.current = value;
    if (prefersReducedMotion() || from === value) {
      node.textContent = formatRef.current(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      node.textContent = formatRef.current(from + (value - from) * easeOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref, value, durationMs]);

  // Currency or scope changes re-format without restarting the roll.
  useEffect(() => {
    const node = ref.current;
    if (node && value != null && Number.isFinite(value) && previous.current === value) {
      node.textContent = format(value);
    }
  }, [format, ref, value]);
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Runs a DOM update inside a view transition when the browser supports it. */
export function withViewTransition(update: () => void): void {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => {
    flushSync(update);
  });
}

/** Changes once per distinct value so CSS can replay a one-shot animation. */
export function usePulseKey(value: unknown): number {
  const [key, setKey] = useState(0);
  const last = useRef(value);
  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      setKey((k) => k + 1);
    }
  }, [value]);
  return key;
}
