import { Button } from "@/ui/primitives";
import { Icon } from "@/ui/Icon";
import { LedgerMark } from "@/ui/LedgerMark";

/** Whole-screen state for opening, offline, and unreachable moments. No app chrome. */
export function FullScreenMessage(props: {
  tone: "loading" | "offline" | "error";
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 pt-safe pb-safe text-center">
      <div className="animate-rise-in">
        <LedgerMark size={56} className={props.tone === "loading" ? "animate-pulse" : ""} />
      </div>
      <h1 className="mt-6 text-title font-semibold" role={props.tone === "loading" ? "status" : "alert"}>
        {props.title}
      </h1>
      {props.body ? <p className="mt-2 max-w-xs text-caption text-muted-foreground">{props.body}</p> : null}
      {props.tone !== "loading" ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-micro text-subtle">
          <Icon name={props.tone === "offline" ? "offline" : "alert"} size={14} />
          Ledger does not store balances on this device.
        </p>
      ) : null}
      {props.action ? (
        <Button variant="secondary" icon="refresh" className="mt-6" onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      ) : null}
    </main>
  );
}
