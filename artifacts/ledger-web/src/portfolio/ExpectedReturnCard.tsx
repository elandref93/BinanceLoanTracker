import type { PortfolioAsset, PortfolioAssetDetail } from "@workspace/api-client-react";
import { getGetPortfolioAssetQueryKey, getPortfolioAsset } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { loadSettings, settingsSyncQueryKey } from "@/alerts/alertApi";
import { fmtDate, fmtPct, fmtSignedPct } from "@/domain/format";
import { holdingTitle } from "@/portfolio/holdings";
import {
  applyExpectedReturn,
  comparisonAsOf,
  compareExpectedReturn,
  expectedReturnRows,
  holdingStart,
  parseExpectedAnnual,
  readExternalFlows,
  readExpectedReturn,
  readExpectedReturns,
  returnStatusLabel,
  type ReturnStatus,
} from "@/portfolio/expectedReturn";
import { investmentPath } from "@/portfolio/perecDrill";
import { useScopeParam } from "@/portfolio/queries";
import { saveSettings } from "@/settings/settingsApi";
import { displaySymbol } from "@/ui/AssetIcon";
import { Button, Card, cx, SectionHeader, Skeleton } from "@/ui/primitives";

function statusClass(status: ReturnStatus | null): string {
  if (status === "ahead") return "text-gain";
  if (status === "behind") return "text-loss";
  if (status === "on_par") return "text-foreground";
  return "text-muted-foreground";
}

export function ExpectedReturnCard(props: { detail: PortfolioAssetDetail; savedSnapshot?: boolean; className?: string }) {
  const asset = props.detail.asset.asset;
  const fieldId = `expected-return-${asset.replace(/[^\w-]+/g, "-")}`;
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings });
  const stored = settings.isSuccess ? readExpectedReturn(settings.data, asset) : null;
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);

  useEffect(() => {
    if (!settings.isSuccess || dirty) return;
    setDraft(stored == null ? "" : String(stored));
  }, [dirty, settings.isSuccess, stored]);

  const start = holdingStart(props.detail);
  const comparison =
    stored != null && start
      ? compareExpectedReturn({
          annualPct: stored,
          startedAt: start.t,
          startUsd: start.usd,
          nowUsd: props.detail.asset.usd,
          nowMs: comparisonAsOf(props.detail.priceHistory),
          marks: props.detail.holdingHistory,
          flows: readExternalFlows(props.detail),
        })
      : null;

  async function save(annualPct: number | null) {
    setSaving(true);
    setMessage(null);
    try {
      const current = await queryClient.fetchQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings, staleTime: 0 });
      let result = await saveSettings(applyExpectedReturn(current, asset, annualPct));
      if (!result.ok && result.conflict) {
        const fresh = await queryClient.fetchQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings, staleTime: 0 });
        result = await saveSettings(applyExpectedReturn(fresh, asset, annualPct));
      }
      await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
      if (!result.ok) {
        setMessage({ text: result.message, alert: true });
        return;
      }
      setDirty(false);
      setDraft(annualPct == null ? "" : String(annualPct));
      setMessage({ text: annualPct == null ? "Expected return cleared." : "Expected return saved.", alert: false });
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const raw = draft.trim();
    if (raw === "") {
      void save(null);
      return;
    }
    const parsed = parseExpectedAnnual(raw);
    if (parsed == null) {
      setMessage({ text: "Enter an annual percent from -100 to 1000.", alert: true });
      return;
    }
    void save(parsed);
  }

  return (
    <Card className={props.className} aria-labelledby="expected-return-title">
      <SectionHeader
        id="expected-return-title"
        title="Expected return"
        caption="Annual target, prorated from the first history point"
      />
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="block text-caption text-muted-foreground" htmlFor={fieldId}>
          Expected annual return
          <span className="mt-1 flex items-center gap-2">
            <input
              id={fieldId}
              inputMode="decimal"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
                setMessage(null);
              }}
              className="w-28 rounded-ledger border border-border bg-background px-3 py-2 text-body text-foreground"
              autoComplete="off"
              disabled={saving || settings.isPending}
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={saving || settings.isPending}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {stored != null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setDraft("");
              setDirty(true);
              void save(null);
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>
      {message ? (
        <p role={message.alert ? "alert" : "status"} className={cx("mt-3 text-caption", message.alert ? "text-danger" : "text-muted-foreground")}>
          {message.text}
        </p>
      ) : null}
      {stored == null ? (
        <p className="mt-3 text-caption text-muted-foreground">No expected return is set for this holding.</p>
      ) : comparison ? (
        <dl className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Target so far</dt>
            <dd className="mt-1 text-body font-semibold tabular">{fmtPct(comparison.expectedPct)}</dd>
          </div>
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Actual</dt>
            <dd className="mt-1 text-body font-semibold tabular">{comparison.actualPct == null ? "—" : fmtSignedPct(comparison.actualPct)}</dd>
          </div>
          <div>
            <dt className="text-micro font-medium uppercase tracking-wider text-muted-foreground">Versus target</dt>
            <dd className={cx("mt-1 text-body font-semibold tabular", statusClass(comparison.status))}>
              {comparison.status == null ? "—" : returnStatusLabel(comparison.status, comparison.gapPp)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-caption text-muted-foreground">
          {props.savedSnapshot ? "History is not in the saved snapshot." : "Not enough history to compare yet."}
        </p>
      )}
      {stored != null && comparison ? (
        <p className="mt-3 text-micro text-muted-foreground">
          {fmtPct(stored, Number.isInteger(stored) ? 0 : 1)} a year since {fmtDate(comparison.startedAt)}. The target so far is that percent times the share of a year elapsed.
          {comparison.flowsRemoved ? " Deposits and withdrawals are left out of the actual return." : ""}
          {comparison.actualPct == null ? " Actual return is not shown because the starting value is not a real position." : ""}
        </p>
      ) : null}
    </Card>
  );
}

export function ExpectedReturnsInsight(props: { assets: PortfolioAsset[] | null; savedSnapshot?: boolean; className?: string }) {
  const settings = useQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings });
  const scope = useScopeParam();
  const targets = useMemo(() => (settings.isSuccess ? readExpectedReturns(settings.data) : {}), [settings.data, settings.isSuccess]);
  const holdings = useMemo(() => {
    if (!props.assets) return [];
    return props.assets
      .filter((asset) => targets[asset.asset] != null)
      .map((asset) => ({
        asset: asset.asset,
        title: holdingTitle(displaySymbol(asset.asset), asset.positions),
      }));
  }, [props.assets, targets]);
  const params = scope ? { scope } : undefined;
  const detailQueries = useQueries({
    queries: holdings.map((holding) => {
      const encoded = encodeURIComponent(holding.asset);
      return {
        queryKey: getGetPortfolioAssetQueryKey(encoded, params),
        queryFn: () => getPortfolioAsset(encoded, params),
        staleTime: 60_000,
      };
    }),
  });
  const details = new Map<string, PortfolioAssetDetail | null>();
  holdings.forEach((holding, index) => {
    const data = detailQueries[index]?.data;
    details.set(holding.asset, data && data.available ? data : null);
  });
  const rows = expectedReturnRows({ targets, holdings, details });

  if (!props.assets || !settings.isSuccess || holdings.length === 0) return null;
  const loading = detailQueries.some((query) => query.isPending);

  return (
    <Card className={props.className} aria-label="Expected returns">
      <SectionHeader title="Expected returns" caption="Prorated from each holding's first history point" />
      {loading && rows.every((row) => row.comparison == null) ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.asset} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link to={investmentPath(row.asset)} viewTransition className="text-body font-medium text-foreground hover:text-primary">
                  {row.title}
                </Link>
                <p className="text-micro text-muted-foreground">
                  {fmtPct(row.annualPct, Number.isInteger(row.annualPct) ? 0 : 1)} a year
                  {row.comparison ? ` · since ${fmtDate(row.comparison.startedAt)}` : ""}
                </p>
              </div>
              {row.comparison ? (
                <p className="text-right text-caption tabular">
                  <span className="text-muted-foreground">Target {fmtPct(row.comparison.expectedPct)}</span>
                  {row.comparison.actualPct == null || row.comparison.status == null ? (
                    <span className="mt-0.5 block text-muted-foreground">Actual return needs a real starting value</span>
                  ) : (
                    <>
                      <span className="mx-1.5 text-subtle">·</span>
                      <span>Actual {fmtSignedPct(row.comparison.actualPct)}</span>
                      <span className={cx("mt-0.5 block font-semibold", statusClass(row.comparison.status))}>
                        {returnStatusLabel(row.comparison.status, row.comparison.gapPp)}
                      </span>
                    </>
                  )}
                </p>
              ) : (
                <p className="text-caption text-muted-foreground">{props.savedSnapshot ? "History is not in the saved snapshot." : "Not enough history to compare yet."}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
