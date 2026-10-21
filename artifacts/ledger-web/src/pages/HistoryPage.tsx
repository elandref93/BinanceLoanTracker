import { useGetLtvSnapshot, useListInterest, type ListInterest200 } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import {
  buildHistoryView,
  DAILY_RANGES,
  NO_BROWSER_HISTORY,
  type DailyRange,
  type HistoryCurrency,
  type HistoryInterest,
  type HistoryLoad,
  type HistorySnapshot,
} from "@/domain/historyView";
import { AprSparkline, DailyChargeChart, SeriesChart } from "@/history/HistoryCharts";
import { Balance } from "@/prefs/DiscreetMode";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { PageHeader } from "@/ui/primitives";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

function Line(props: { label: string; line: { text: string; source: string | null }; extra?: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd>
        <Balance text={props.line.text} />
        {props.line.source ? <span className="mt-1 block text-xs text-muted-foreground">{props.line.source}</span> : null}
        {props.extra ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            Saved snapshot <Balance text={props.extra} />
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function toSnapshot(value: unknown): HistorySnapshot | null {
  if (!value || typeof value !== "object") return null;
  return value as HistorySnapshot;
}

function toInterest(data: ListInterest200): HistoryInterest {
  return {
    totalUsd: data.totalUsd,
    weightedApr: data.weightedApr,
    projected30dUsd: data.projected30dUsd,
    byLoan: data.byLoan.map((loan) => ({
      loanId: loan.loanId,
      accountId: loan.accountId,
      asset: loan.asset,
      collateralAsset: loan.collateralAsset,
      currentApr: loan.currentApr,
      avg30dApr: loan.avg30dApr,
      min30dApr: loan.min30dApr,
      max30dApr: loan.max30dApr,
      projected30dUsd: loan.projected30dUsd,
      lifetimeInterestUsd: loan.lifetimeInterestUsd,
      loanAgeDays: loan.loanAgeDays,
      rateHistory: loan.rateHistory,
    })),
    byAsset: data.byAsset.map((asset) => ({
      asset: asset.asset,
      debtUsd: asset.debtUsd,
      weightedApr: asset.weightedApr,
      projected30dUsd: asset.projected30dUsd,
    })),
    rows: data.rows.map((row) => ({ ts: row.ts, amountUsd: row.amountUsd })),
  };
}

export function HistoryPage() {
  const snapshotQuery = useGetLtvSnapshot();
  const interestQuery = useListInterest();
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const currency: HistoryCurrency = usePrefs().currency;
  const [dailyRange, setDailyRange] = useState<DailyRange>(30);

  const snapshotState: HistoryLoad = snapshotQuery.isPending
    ? "loading"
    : snapshotQuery.isError || !snapshotQuery.data?.available
      ? "missing"
      : "ready";
  const interestState: HistoryLoad = interestQuery.isPending ? "loading" : interestQuery.isError ? "missing" : "ready";
  const accountLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const container of accounts.data ?? []) {
      for (const link of container.links) {
        labels.set(link.id, link.label ? `${container.name} · ${link.label}` : container.name);
      }
    }
    return labels;
  }, [accounts.data]);

  const view = useMemo(
    () =>
      buildHistoryView({
        snapshotState,
        snapshot: snapshotState === "ready" ? toSnapshot(snapshotQuery.data?.snapshot) : null,
        interestState,
        interest: interestState === "ready" && interestQuery.data ? toInterest(interestQuery.data) : null,
        currency,
        accountLabels,
        dailyRange,
      }),
    [snapshotState, snapshotQuery.data, interestState, interestQuery.data, currency, accountLabels, dailyRange],
  );

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeader title="Interest history" back={{ to: "/loans", label: "Loans" }} />
      <p className="text-sm text-muted-foreground">
        Lifetime and projected interest, LTV history, daily charges, and APR series. Dates and times are
        Africa/Johannesburg. Daily-charge days are the UTC dates returned by the API. {NO_BROWSER_HISTORY}
      </p>
      {view.asOfLabel ? <p className="mt-2 text-sm text-muted-foreground">Snapshot as of {view.asOfLabel}.</p> : null}
      {view.fxLabel ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Snapshot rate <Balance text={view.fxLabel} />.
        </p>
      ) : null}
      {view.zarNote ? <p className="mt-1 text-sm text-muted-foreground">{view.zarNote}</p> : null}

      <div className="mt-4 space-y-3">
        {snapshotQuery.isError ? (
          <p role="alert" className="text-sm text-danger">
            The snapshot could not be loaded. LTV history and snapshot interest are not shown.
          </p>
        ) : null}
        {interestQuery.isError ? (
          <p role="alert" className="text-sm text-danger">
            The interest API could not be loaded. Charged interest and the APR series are not shown.
          </p>
        ) : null}
        {accounts.isError ? (
          <p role="alert" className="text-sm text-danger">
            Linked accounts could not be loaded, so loan rows do not use a profile name.
          </p>
        ) : null}

        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Line label="Lifetime interest" line={view.lifetime} extra={view.snapshotLifetime} />
            <Line label="Projected · next 30d" line={view.projected} extra={view.snapshotProjected} />
            <Line label="Charged · 30d" line={view.charged30d} />
            <Line label="Weighted APR" line={view.weightedApr} />
            <Line label="Open loans" line={view.openLoans} />
          </dl>
        </Card>

        <Card>
          <h2 className="text-sm font-medium">LTV history</h2>
          <div className="mt-3">
            {view.ltvLine ? (
              <SeriesChart values={view.ltvPoints.map((point) => point.value)} summary={view.ltvSummary} />
            ) : (
              <p className="text-sm text-muted-foreground">{view.ltvMessage}</p>
            )}
          </div>
          {view.ltvPoints.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-sm">
              {view.ltvPoints.map((point) => (
                <li key={`${point.label}-${point.ltv}`}>
                  {point.label}: {point.ltv}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Daily charges</h2>
            <div className="flex rounded-ledger border border-border p-1 text-sm">
              {DAILY_RANGES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={dailyRange === option}
                  className={
                    dailyRange === option
                      ? "rounded-ledger bg-primary px-2 py-1 text-primary-foreground"
                      : "rounded-ledger px-2 py-1 text-muted-foreground"
                  }
                  onClick={() => setDailyRange(option)}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3">
            {view.dailyPoints.length > 0 ? (
              <DailyChargeChart
                points={view.dailyPoints.map((point) => ({ day: point.day, usd: point.usd }))}
                summary={view.dailySummary}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{view.dailyMessage}</p>
            )}
          </div>
          {view.dailyPoints.length > 0 ? (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">{view.dailySummary}</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 font-medium">Day</th>
                  <th className="py-1 text-right font-medium">Charge</th>
                </tr>
              </thead>
              <tbody>
                {view.dailyPoints.map((point) => (
                  <tr key={point.day} className="border-t border-border">
                    <td className="py-1">{point.label}</td>
                    <td className="py-1 text-right">
                      <Balance text={point.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-sm font-medium">By loan</h2>
          {view.aprMessage ? <p className="mt-2 text-sm text-muted-foreground">{view.aprMessage}</p> : null}
          {view.loansMessage ? <p className="mt-2 text-sm text-muted-foreground">{view.loansMessage}</p> : null}
          <ul className="mt-3 space-y-3">
            {view.loans.map((loan) => (
              <li key={loan.loanId} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link className="font-medium text-primary" to={`/loans/${encodeURIComponent(loan.loanId)}`}>
                    {loan.title}
                  </Link>
                  <span className="text-sm">
                    <Balance text={loan.projected} />
                    <span className="text-muted-foreground"> / 30d</span>
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{loan.accountLabel}</p>
                <p className="mt-1 text-sm">
                  APR {loan.currentApr} · 30d avg {loan.avg30dApr}
                  {loan.delta ? (
                    <span className={loan.delta.direction === "up" ? "text-warn" : "text-ok"}> {loan.delta.text}</span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  30d range {loan.range} · lifetime <Balance text={loan.lifetime} /> · age {loan.loanAge}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{loan.aprSummary}</p>
                <AprSparkline values={loan.aprValues} summary={loan.aprSummary} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-medium">By borrowed asset</h2>
          {view.assetsMessage ? <p className="mt-2 text-sm text-muted-foreground">{view.assetsMessage}</p> : null}
          <ul className="mt-3 space-y-3">
            {view.assets.map((asset) => (
              <li key={asset.asset} className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  {asset.asset}
                  <span className="mt-1 block text-muted-foreground">
                    <Balance text={asset.debt} /> debt · weighted APR {asset.weightedApr}
                  </span>
                </span>
                <span>
                  <Balance text={asset.projected} />
                  <span className="text-muted-foreground"> / 30d</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
