import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/ui/Icon";
import { cx } from "@/ui/primitives";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centred dialog from 640px. Focus stays inside while
 * open, Escape closes, focus returns to the opener, and the page behind does
 * not scroll. On touch, dragging the handle down past 120px dismisses.
 */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    if (!props.open) return;
    opener.current = document.activeElement;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem?.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = previousOverflow;
      setDragY(0);
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, [props.open]);

  if (!props.open || typeof document === "undefined") return null;

  const width = props.size === "lg" ? "sm:max-w-2xl" : props.size === "sm" ? "sm:max-w-sm" : "sm:max-w-lg";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in"
        onClick={props.onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[22px] border border-border-strong bg-card shadow-2xl outline-none",
          "animate-sheet-up sm:animate-pop-in sm:rounded-[20px]",
          width,
        )}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        <div
          className="flex shrink-0 touch-none flex-col px-5 pt-2.5 sm:pt-5"
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") return;
            dragStart.current = event.clientY;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStart.current == null) return;
            setDragY(Math.max(0, event.clientY - dragStart.current));
          }}
          onPointerUp={() => {
            if (dragStart.current == null) return;
            dragStart.current = null;
            if (dragY > 120) props.onClose();
            else setDragY(0);
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <span aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border-strong sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-heading font-semibold">
                {props.title}
              </h2>
              {props.description ? <div className="mt-1 text-caption text-muted-foreground">{props.description}</div> : null}
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{props.children}</div>
        {props.footer ? (
          <div className="shrink-0 border-t border-border px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{props.footer}</div>
        ) : (
          <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
        )}
      </div>
    </div>,
    document.body,
  );
}
