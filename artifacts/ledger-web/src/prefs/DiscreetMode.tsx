import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DISCREET_PLACEHOLDER, maskAmountsInText, splitAmountParts } from "@/prefs/discreet";

type DiscreetValue = {
  enabled: boolean;
  /** True while the pointer is over any amount and discreet mode is on. */
  revealed: boolean;
  hidden: boolean;
  /** Replace amount tokens. Other words stay, including when the string is a sentence. */
  mask: (text: string) => string;
};

const OFF: DiscreetValue = {
  enabled: false,
  revealed: false,
  hidden: false,
  mask: (text) => text,
};

const DiscreetContext = createContext<DiscreetValue>(OFF);

/**
 * One reveal flag for the whole app. Hovering any `[data-balance]` shows every
 * amount; leaving the last one hides them. A press on a touch screen reveals
 * while the finger is down.
 */
export function DiscreetProvider(props: { enabled: boolean; revealed?: boolean; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const revealed = props.revealed ?? hovered;
  const enabled = props.enabled;

  useEffect(() => {
    if (!enabled || props.revealed != null) {
      setHovered(false);
      return;
    }
    const depth = { current: 0 };
    const touch = { current: 0 };
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const next = depth.current > 0;
      setHovered((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    };
    const balanceOf = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      return target.closest("[data-balance]");
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const balance = balanceOf(event.target);
      if (!balance) return;
      const from = event.relatedTarget;
      if (from instanceof Node && balance.contains(from)) return;
      depth.current += 1;
      schedule();
    };
    const onOut = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const balance = balanceOf(event.target);
      if (!balance) return;
      const to = event.relatedTarget;
      if (to instanceof Node && balance.contains(to)) return;
      depth.current = Math.max(0, depth.current - 1);
      schedule();
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (!balanceOf(event.target)) return;
      touch.current += 1;
      depth.current += 1;
      schedule();
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (touch.current === 0) return;
      touch.current -= 1;
      depth.current = Math.max(0, depth.current - 1);
      schedule();
    };
    const reset = () => {
      depth.current = 0;
      touch.current = 0;
      schedule();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", reset);
    };
  }, [enabled, props.revealed]);

  const value = useMemo<DiscreetValue>(
    () => ({
      enabled,
      revealed: enabled && revealed,
      hidden: enabled && !revealed,
      mask: (text) => maskAmountsInText(text, enabled && !revealed),
    }),
    [enabled, revealed],
  );

  return <DiscreetContext.Provider value={value}>{props.children}</DiscreetContext.Provider>;
}

export function useDiscreet(): DiscreetValue {
  return useContext(DiscreetContext);
}

/**
 * Renders a figure, or a sentence that contains figures. Amount tokens are the
 * hover targets. Neighbouring words are not, so a name or a date does not reveal balances.
 */
export function Balance(props: { text: string; className?: string; figure?: boolean }) {
  const discreet = useDiscreet();
  const parts =
    props.figure && /\d/.test(props.text) ? [{ amount: true, text: props.text }] : splitAmountParts(props.text);
  const hasAmount = parts.some((part) => part.amount);
  if (!discreet.enabled || !hasAmount) {
    return <span className={props.className}>{props.text}</span>;
  }
  return (
    <span className={props.className}>
      {parts.map((part, index) =>
        part.amount ? (
          <span key={index} data-balance="">
            {discreet.revealed ? part.text : DISCREET_PLACEHOLDER}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
