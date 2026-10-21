import type { ButtonHTMLAttributes, CSSProperties, ElementType, ReactNode } from "react";
import { Link } from "react-router";

import { fmtPct, fmtSignedMoney, fmtSignedPct, MINUS } from "@/domain/format";
import { riskBand, riskBandLabel, type RiskBand } from "@/domain/risk";
import { Balance } from "@/prefs/DiscreetMode";
import { Icon, type IconName } from "@/ui/Icon";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card(props: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  padded?: boolean;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const Tag = props.as ?? "section";
  return (
    <Tag
      className={cx(
        "@container min-w-0 max-w-full rounded-ledger border border-border bg-card",
        props.padded === false ? "" : "p-4 lg:p-5",
        props.className,
      )}
      style={props.style}
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
    >
      {props.children}
    </Tag>
  );
}

export function SectionHeader(props: { title: string; id?: string; action?: ReactNode; caption?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={props.id} className="text-heading font-semibold text-foreground">
          {props.title}
        </h2>
        {props.caption ? <p className="mt-0.5 text-caption text-muted-foreground">{props.caption}</p> : null}
      </div>
      {props.action ? <div className="min-w-0 max-w-full">{props.action}</div> : null}
    </div>
  );
}

export function PageHeader(props: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <header className="mb-5 animate-fade-in">
      {props.back ? (
        <Link
          to={props.back.to}
          viewTransition
          className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-ledger px-2 text-body text-primary"
        >
          <Icon name="chevronLeft" size={18} />
          {props.back.label}
        </Link>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {props.leading}
          <div className="min-w-0">
            <h1 className="truncate text-title font-semibold tracking-tight lg:text-[28px] lg:leading-[34px]">{props.title}</h1>
            {props.subtitle ? <div className="mt-1 text-caption text-muted-foreground">{props.subtitle}</div> : null}
          </div>
        </div>
        {props.actions ? <div className="flex shrink-0 items-center gap-2">{props.actions}</div> : null}
      </div>
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName; size?: "md" | "sm" },
) {
  const { variant = "secondary", icon, size = "md", className, children, ...rest } = props;
  const tone =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:brightness-110"
      : variant === "danger"
        ? "border border-danger/40 text-danger hover:bg-danger/10"
        : variant === "ghost"
          ? "text-primary hover:bg-primary/10"
          : "border border-border-strong bg-card-elevated text-foreground hover:border-primary/40";
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-ledger font-medium transition-[filter,background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "min-h-9 px-3 text-caption" : "min-h-11 px-4 text-body",
        tone,
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export function IconButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; spinning?: boolean },
) {
  const { icon, label, spinning, className, ...rest } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card-elevated hover:text-foreground disabled:opacity-40",
        className,
      )}
    >
      <Icon name={icon} size={20} className={spinning ? "animate-spin-slow" : undefined} />
    </button>
  );
}

/**
 * Equal-width segmented control with a sliding indicator. Each segment is at
 * least 36px tall inside a 44px hit area on touch screens.
 */
export function Segmented<T extends string>(props: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const index = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  const count = props.options.length;
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className={cx(
        "relative grid min-w-0 max-w-full rounded-full border border-border bg-background p-1",
        props.size === "sm" ? "text-micro" : "text-caption",
        props.className,
      )}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-card-elevated shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-transform duration-300 ease-[var(--ease-ledger)]"
        style={{ width: `calc((100% - 0.5rem) / ${count})`, transform: `translateX(${index * 100}%)` }}
      />
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => props.onChange(option.value)}
            className={cx(
              "relative z-10 min-w-0 truncate rounded-full px-2 font-semibold transition-colors",
              props.size === "sm" ? "min-h-8" : "min-h-9",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton(props: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cx("block skeleton", props.className)} style={props.style} />;
}

type NoticeTone = "info" | "warn" | "danger" | "offline" | "ok";

export function Notice(props: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const tone = props.tone ?? "info";
  const styles: Record<NoticeTone, { box: string; icon: IconName; iconClass: string }> = {
    info: { box: "border-border bg-card", icon: "info", iconClass: "text-muted-foreground" },
    ok: { box: "border-ok/30 bg-ok/5", icon: "check", iconClass: "text-ok" },
    warn: { box: "border-warn/30 bg-warn/5", icon: "alert", iconClass: "text-warn" },
    danger: { box: "border-danger/40 bg-danger/10", icon: "alert", iconClass: "text-danger" },
    offline: { box: "border-border-strong bg-card-elevated", icon: "offline", iconClass: "text-muted-foreground" },
  };
  const style = styles[tone];
  return (
    <div
      role={props.role ?? (tone === "danger" ? "alert" : "status")}
      className={cx("flex gap-3 rounded-ledger border p-3.5 animate-fade-in", style.box, props.className)}
    >
      <Icon name={style.icon} size={18} className={cx("mt-0.5 shrink-0", style.iconClass)} />
      <div className="min-w-0 flex-1 text-caption">
        {props.title ? <p className="font-semibold text-foreground">{props.title}</p> : null}
        {props.children ? <div className={cx("text-muted-foreground", props.title ? "mt-0.5" : "")}>{props.children}</div> : null}
      </div>
      {props.action ? <div className="shrink-0 self-center">{props.action}</div> : null}
    </div>
  );
}

export function EmptyState(props: { icon: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center animate-fade-in">
      <span className="flex size-12 items-center justify-center rounded-full bg-card-elevated text-muted-foreground">
        <Icon name={props.icon} size={22} />
      </span>
      <p className="mt-4 text-heading font-semibold">{props.title}</p>
      {props.body ? <div className="mt-1 max-w-sm text-caption text-muted-foreground">{props.body}</div> : null}
      {props.action ? <div className="mt-5">{props.action}</div> : null}
    </div>
  );
}

/** Small provenance chip: where a number came from and when. */
export function SourceTag(props: { children: ReactNode; tone?: "default" | "estimate" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium",
        props.tone === "estimate"
          ? "bg-primary/10 text-primary"
          : props.tone === "warn"
            ? "bg-warn/10 text-warn"
            : "bg-card-elevated text-muted-foreground",
      )}
    >
      {props.children}
    </span>
  );
}

export function deltaTone(value: number | null | undefined): "gain" | "loss" | "flat" {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "gain" : "loss";
}

/** Signed money and/or percentage, coloured and arrowed. Never colour alone. */
export function Delta(props: {
  amount?: number | null;
  pct?: number | null;
  currency: "USD" | "ZAR";
  compact?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const basis = props.amount ?? props.pct ?? null;
  const tone = deltaTone(basis);
  const color = tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-muted-foreground";
  const textSize = props.size === "lg" ? "text-heading" : props.size === "sm" ? "text-micro" : "text-caption";
  const parts: string[] = [];
  if (props.amount != null && Number.isFinite(props.amount)) {
    parts.push(fmtSignedMoney(props.amount, props.currency, { whole: true, compact: props.compact }));
  }
  if (props.pct != null && Number.isFinite(props.pct)) {
    const pct = fmtSignedPct(props.pct, 1);
    parts.push(parts.length > 0 ? `(${pct})` : pct);
  }
  if (parts.length === 0) return <span className={cx("tabular text-muted-foreground", textSize, props.className)}>—</span>;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap font-semibold tabular", textSize, color, props.className)}>
      {tone === "flat" ? null : <Icon name={tone === "gain" ? "arrowUp" : "arrowDown"} size={props.size === "lg" ? 16 : 13} strokeWidth={2.25} />}
      <Balance text={parts.join(" ")} />
      <span className="sr-only">{tone === "gain" ? "up" : tone === "loss" ? "down" : "unchanged"}</span>
    </span>
  );
}

const BAND_STYLES: Record<RiskBand, string> = {
  healthy: "bg-ok/12 text-ok ring-1 ring-ok/30",
  above: "bg-warn/12 text-warn ring-1 ring-warn/30",
  margin: "bg-danger/12 text-danger ring-1 ring-danger/40",
  liquidation: "bg-danger text-white",
};

export const BAND_SHAPES: Record<RiskBand, string> = {
  healthy: "●",
  above: "▲",
  margin: "◆",
  liquidation: "■",
};

export function RiskBadge(props: { ltv: number; target?: number; withValue?: boolean; size?: "sm" | "md" }) {
  if (!Number.isFinite(props.ltv)) {
    return <span className="text-micro text-muted-foreground">LTV —</span>;
  }
  const band = riskBand(props.ltv, props.target);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold tabular",
        props.size === "sm" ? "px-2 py-0.5 text-micro" : "px-2.5 py-1 text-caption",
        BAND_STYLES[band],
      )}
    >
      <span aria-hidden="true" className="text-[0.7em]">
        {BAND_SHAPES[band]}
      </span>
      {props.withValue ? `${fmtPct(props.ltv)} · ` : ""}
      {riskBandLabel(band)}
    </span>
  );
}

export function riskTextClass(band: RiskBand): string {
  if (band === "healthy") return "text-ok";
  if (band === "above") return "text-warn";
  return "text-danger";
}

export function riskColor(band: RiskBand): string {
  if (band === "healthy") return "#1FB6A6";
  if (band === "above") return "#F5A524";
  return "#FF4D6D";
}

export function ProfileBadge(props: { type: "personal" | "trust" | string | undefined }) {
  const trust = props.type === "trust";
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide",
        trust ? "bg-[#7C6AEF]/15 text-[#A99CF5]" : "bg-[#00C2FF]/12 text-[#5FD6FF]",
      )}
    >
      {trust ? "Trust" : "Personal"}
    </span>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", props.className)}>
      <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-heading font-semibold tabular">{props.value}</dd>
      {props.hint ? <dd className="mt-0.5 text-micro text-muted-foreground">{props.hint}</dd> : null}
    </div>
  );
}

export function Disclosure(props: { title: string; caption?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-ledger border border-border bg-card open:pb-4" open={props.defaultOpen}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-body font-semibold">{props.title}</span>
          {props.caption ? <span className="block text-caption text-muted-foreground">{props.caption}</span> : null}
        </span>
        <Icon name="chevronDown" size={18} className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="px-4 animate-fade-in">{props.children}</div>
    </details>
  );
}

export function ListRow(props: {
  to?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  trailingSub?: ReactNode;
  chevron?: boolean;
  viewTransitionName?: string;
}) {
  const body = (
    <>
      {props.leading ? <span className="shrink-0">{props.leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{props.title}</span>
        {props.subtitle ? <span className="mt-0.5 block truncate text-caption text-muted-foreground">{props.subtitle}</span> : null}
      </span>
      {props.trailing != null ? (
        <span className="shrink-0 text-right">
          <span className="block text-body font-semibold tabular">{props.trailing}</span>
          {props.trailingSub ? <span className="mt-0.5 block text-caption">{props.trailingSub}</span> : null}
        </span>
      ) : null}
      {props.chevron ? <Icon name="chevronRight" size={16} className="shrink-0 text-subtle" /> : null}
    </>
  );
  const className =
    "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-card-elevated active:bg-card-elevated";
  if (props.to) {
    return (
      <Link to={props.to} viewTransition className={className}>
        {body}
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" onClick={props.onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className.replace(" hover:bg-card-elevated active:bg-card-elevated", "")}>{body}</div>;
}

export function Spinner(props: { size?: number }) {
  return <Icon name="refresh" size={props.size ?? 18} className="animate-spin-slow text-muted-foreground" />;
}

export const MINUS_SIGN = MINUS;
