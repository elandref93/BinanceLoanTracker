import type { PnlPeriod } from "@workspace/api-client-react";
import type { ReactNode } from "react";

import { fmtDateTime, fmtSignedPct } from "@/domain/format";
import { usePrefs, useProfileName } from "@/prefs/PreferencesProvider";
import { AssetIcon } from "@/ui/AssetIcon";
import { cx, deltaTone, Notice } from "@/ui/primitives";
import { Sheet } from "@/ui/Sheet";

const BASIS_NOTE: Record<PnlPeriod["basis"], string> = {
  ledger: "Worked out from your full transaction history. Deposits and withdrawals are excluded.",
  snapshots: "History is still importing, so this compares snapshots only. A deposit in this period would count as a gain.",
  none: "There is no snapshot from the start of this period yet.",
};

/** Tapping a P&L tile: where the money came from, by source, asset and profile. */
export function PnlBreakdownSheet(props: { open: boolean; onClose: () => void; title: string; period: PnlPeriod | null }) {
  const prefs = usePrefs();
  const profileName = useProfileName();
  const period = props.period;
  const attribution = period?.attribution ?? null;
  const sources = attribution
    ? [
        { label: "Market moves", usd: attribution.marketUsd },
        { label: "Earn income", usd: attribution.incomeUsd },
        { label: "Interest and fees", usd: attribution.costsUsd },
        { label: "Other", usd: attribution.otherUsd },
      ]
    : [];
  const maxSource = Math.max(1, ...sources.map((item) => Math.abs(item.usd)));

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      description={period ? `Since ${fmtDateTime(period.from)}, Johannesburg time` : undefined}
      size="md"
    >
      {period ? (
        <div className="flex flex-col gap-5 pb-2">
          <div>
            <p
              className={cx(
                "text-title font-semibold tabular",
                deltaTone(period.pnlUsd) === "gain" ? "text-gain" : deltaTone(period.pnlUsd) === "loss" ? "text-loss" : "text-foreground",
              )}
            >
              {period.pnlUsd == null ? "—" : prefs.money(period.pnlUsd, { signed: true })}
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground tabular">
              {period.pct != null ? `${fmtSignedPct(period.pct, 2)} time-weighted return` : "Return not available"}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-3 rounded-ledger border border-border p-3">
            <Figure label="Start" value={period.startUsd == null ? "—" : prefs.money(period.startUsd, { whole: true })} />
            <Figure label="Now" value={period.endUsd == null ? "—" : prefs.money(period.endUsd, { whole: true })} />
            <Figure label="Net deposits" value={prefs.money(period.flowsUsd, { signed: true, whole: true })} />
          </dl>

          {attribution ? (
            <section aria-labelledby="pnl-sources">
              <h3 id="pnl-sources" className="mb-2 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                By source
              </h3>
              <ul className="flex flex-col gap-2.5">
                {sources.map((item) => (
                  <li key={item.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3">
                    <span className="truncate text-caption">{item.label}</span>
                    <DivergingBar value={item.usd} max={maxSource} />
                    <span className={cx("text-caption font-semibold tabular", toneClass(item.usd))}>{prefs.money(item.usd, { signed: true, whole: true })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {attribution && attribution.byAsset.length > 0 ? (
            <section aria-labelledby="pnl-assets">
              <h3 id="pnl-assets" className="mb-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Market moves by asset
              </h3>
              <ul className="-mx-1 flex flex-col">
                {attribution.byAsset.map((item) => (
                  <li key={item.asset} className="flex min-h-11 items-center gap-3 px-1">
                    <AssetIcon asset={item.asset} size={24} />
                    <span className="flex-1 text-body">{item.asset}</span>
                    <span className={cx("text-body font-semibold tabular", toneClass(item.marketUsd))}>{prefs.money(item.marketUsd, { signed: true, whole: true })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {period.byProfile.length > 1 ? (
            <section aria-labelledby="pnl-profiles">
              <h3 id="pnl-profiles" className="mb-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                By profile
              </h3>
              <ul className="-mx-1 flex flex-col">
                {period.byProfile.map((item) => (
                  <li key={item.containerId} className="flex min-h-11 items-center gap-3 px-1">
                    <span className="flex-1 text-body">{profileName(item.containerId)}</span>
                    <span className={cx("text-body font-semibold tabular", toneClass(item.pnlUsd))}>
                      {item.pnlUsd == null ? "—" : prefs.money(item.pnlUsd, { signed: true, whole: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Notice tone={period.basis === "ledger" ? "info" : "warn"}>{BASIS_NOTE[period.basis]}</Notice>
        </div>
      ) : null}
    </Sheet>
  );
}

function toneClass(value: number | null | undefined): string {
  const tone = deltaTone(value);
  return tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-muted-foreground";
}

function Figure(props: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-caption font-semibold tabular">{props.value}</dd>
    </div>
  );
}

function DivergingBar(props: { value: number; max: number }) {
  const width = `${Math.min(50, (Math.abs(props.value) / props.max) * 50)}%`;
  const positive = props.value >= 0;
  return (
    <span className="relative block h-2 rounded-full bg-card-elevated" aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <span
        className={cx("absolute inset-y-0 rounded-full animate-grow-x", positive ? "left-1/2 origin-left bg-gain" : "right-1/2 origin-right bg-loss")}
        style={{ width }}
      />
    </span>
  );
}
