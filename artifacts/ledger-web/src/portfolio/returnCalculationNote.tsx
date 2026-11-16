import { useState } from "react";

import { Icon } from "@/ui/Icon";
import { cx } from "@/ui/primitives";

/** Period and flow notes. A button reveals them for keyboard focus and touch. */
export function ReturnCalculationNote(props: { noteId: string; period: string; flows: string | null }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = open || focused;
  const text = props.flows ? `${props.period} ${props.flows}` : props.period;
  return (
    <>
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-card-elevated hover:text-foreground"
        aria-expanded={shown}
        aria-controls={props.noteId}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <Icon name="info" size={14} />
        <span className="sr-only">How target and actual are calculated</span>
      </button>
      <p id={props.noteId} className={cx("text-micro text-muted-foreground", shown ? "basis-full" : "sr-only")}>
        {text}
      </p>
    </>
  );
}
