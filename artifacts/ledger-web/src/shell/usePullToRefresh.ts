import { useEffect, useRef, useState } from "react";

const THRESHOLD = 72;
const MAX_PULL = 110;

/**
 * Pull-to-refresh for touch screens. An installed PWA has no browser reload
 * control, so this restores the familiar gesture. It only engages when the
 * page is scrolled to the very top and the pull is mostly vertical.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>, enabled = true): { pull: number; armed: boolean; busy: boolean } {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const handler = useRef(onRefresh);
  handler.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;

    function onStart(event: TouchEvent) {
      if (busyRef.current || window.scrollY > 0 || event.touches.length !== 1) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role='dialog'], input, textarea, select, [data-no-pull]")) return;
      const touch = event.touches[0];
      if (touch) start.current = { x: touch.clientX, y: touch.clientY };
    }
    function onMove(event: TouchEvent) {
      const origin = start.current;
      const touch = event.touches[0];
      if (!origin || !touch) return;
      const dy = touch.clientY - origin.y;
      const dx = Math.abs(touch.clientX - origin.x);
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          setPull(0);
        }
        return;
      }
      const eased = Math.min(MAX_PULL, dy * 0.5);
      pullRef.current = eased;
      setPull(eased);
    }
    function onEnd() {
      const distance = pullRef.current;
      start.current = null;
      pullRef.current = 0;
      setPull(0);
      if (distance >= THRESHOLD && !busyRef.current) {
        busyRef.current = true;
        setBusy(true);
        void handler.current().finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
      }
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return { pull, armed: pull >= THRESHOLD, busy };
}
