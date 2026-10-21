import { useGetLtvSnapshot, useListLoans } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import { parseDecimalInput } from "@/domain/decimalInput";
import { fmtNum, fmtPct, MINUS } from "@/domain/format";
import {
  compute,
  DEFAULT_INPUTS,
  type LeverageInputs,
  type TaxMode,
} from "@/domain/leverageSim";
import { SavedScenarios } from "@/strategy/SavedScenarios";
import { snapshotFx } from "@/domain/portfolio";
import {
  buildSummaryHtml,
  chartSummary,
  clamp,
  formatSimMoney,
  inputsFromLivePosition,
  positionForDisplay,
  rateCrossoverYear,
  saTaxYearOn,
  toggleSaTaxYear,
  type SimCurrency,
} from "@/domain/strategyView";
import { Balance, useDiscreet } from "@/prefs/DiscreetMode";
import { DISCREET_PLACEHOLDER } from "@/prefs/discreet";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { LeverageChart } from "@/strategy/LeverageChart";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

function Heading(props: { children: string }) {
  return (
    <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground">{props.children}</h2>
  );
}

export function StrategyPage() {
  const prefs = usePrefs();
  const currency: SimCurrency = prefs.currency;
  const [inputs, setInputs] = useState<LeverageInputs>(DEFAULT_INPUTS);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [borrowAuto, setBorrowAuto] = useState(true);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<null | "table" | "chart">(null);
  const [scenarioTitle, setScenarioTitle] = useState("Unsaved scenario");

  const loansQuery = useListLoans();
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const snapshot = useGetLtvSnapshot();
  const stored =
    snapshot.isSuccess && snapshot.data.available && snapshot.data.snapshot ? snapshot.data.snapshot : null;
  const fx = snapshotFx(stored?.fxUsdToZar);
  const containers = accounts.isSuccess ? accounts.data : [];

  const scopedLoans = useMemo(() => {
    if (!loansQuery.isSuccess) return null;
    const loans = loansQuery.data.loans;
    if (!accountFilter) return loans;
    const container = containers.find((item) => item.id === accountFilter);
    if (!container) return loans;
    const ids = new Set(container.links.map((link) => link.id));
    return loans.filter((loan) => ids.has(loan.accountId));
  }, [loansQuery.isSuccess, loansQuery.data, accountFilter, containers]);

  const position = useMemo(
    () => (scopedLoans == null ? null : positionForDisplay(scopedLoans, fx)),
    [scopedLoans, fx],
  );

  useEffect(() => {
    if (!borrowAuto || position?.weightedAprPct == null) return;
    const rounded = Math.round(position.weightedAprPct * 10) / 10;
    setInputs((prev) => (prev.borrowCost === rounded ? prev : { ...prev, borrowCost: rounded }));
  }, [borrowAuto, position?.weightedAprPct]);

  useEffect(() => {
    if (!accountFilter || !accounts.isSuccess) return;
    const container = accounts.data.find((item) => item.id === accountFilter);
    if (!container) {
      setAccountFilter(null);
      return;
    }
    const want: TaxMode = container.type === "trust" ? "trust" : "personal";
    setInputs((prev) => (prev.taxMode === want ? prev : { ...prev, taxMode: want }));
  }, [accountFilter, accounts.isSuccess, accounts.data]);

  const result = useMemo(() => compute(inputs), [inputs]);
  const lastA = result.rowsA[result.rowsA.length - 1];
  const lastB = result.rowsB[result.rowsB.length - 1];
  const aNet = lastA?.net ?? 0;
  const bNet = lastB?.net ?? 0;
  const winner = aNet >= bNet ? "A" : "B";
  const summary = chartSummary(result, currency, fx);
  const crossover = rateCrossoverYear(result.rowsA, result.rowsB);
  const money = (zar: number) => formatSimMoney(zar, currency, fx);

  function setInput<K extends keyof LeverageInputs>(key: K, value: LeverageInputs[K]): void {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function onUseCurrent(): void {
    if (loansQuery.isPending) {
      setLiveNote("Live loans are still loading.");
      return;
    }
    if (loansQuery.isError || position == null) {
      setLiveNote("Live loans could not be loaded, so current collateral was not applied.");
      return;
    }
    if (position.needsRate) {
      setLiveNote("A USD/ZAR rate was not returned, so current collateral is not converted.");
      return;
    }
    const next = inputsFromLivePosition(inputs, position);
    if (!next) {
      setLiveNote("No BTC-collateralized loans were returned.");
      return;
    }
    setLiveNote(null);
    setInputs(next);
  }

  function onDownload(): void {
    const html = buildSummaryHtml({
      title: scenarioTitle,
      inputs,
      result,
      currency,
      fx,
      generatedAt: new Date(),
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "strategy-summary.html";
    link.click();
    URL.revokeObjectURL(url);
  }

  const liveStatus = loansQuery.isPending
    ? "Checking live loans…"
    : loansQuery.isError
      ? "Live loans could not be loaded. The calculator is using only the numbers you enter."
      : position?.needsRate
        ? "BTC collateral was returned, but no USD/ZAR rate was in the snapshot, so it is not converted."
        : position?.collateralZar == null
          ? "No BTC-collateralized loans were returned."
          : `Current BTC collateral is ${money(position.collateralZar)}.`;

  const inputsPane = (
    <>

      <Card>
        <SavedScenarios
          inputs={inputs}
          onActiveName={setScenarioTitle}
          onApply={(next) => {
            setBorrowAuto(false);
            setLiveNote(null);
            setInputs(next);
          }}
          onReset={() => {
            setInputs(DEFAULT_INPUTS);
            setAccountFilter(null);
            setBorrowAuto(true);
            setLiveNote(null);
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-ledger border border-border px-3 py-1.5 text-sm" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="rounded-ledger border border-border px-3 py-1.5 text-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </Card>

      <Card>
        <Heading>The flow</Heading>
        <ul className="space-y-2 text-sm">
          {flowSteps(inputs, money, result.effectiveCGT).map((step) => (
            <li key={step.title}>
              <span className="font-semibold text-primary">{step.title}. </span>
              <Balance text={step.detail} />
            </li>
          ))}
        </ul>
      </Card>

      {accounts.isError ? (
        <Card>
          <p role="status">Profiles could not be loaded. The calculator is not scoped to an account.</p>
        </Card>
      ) : null}
      {accounts.isSuccess && containers.length > 0 ? (
        <Card>
          <Heading>Account</Heading>
          <div className="flex flex-wrap gap-2">
            <Choice label="All" pressed={accountFilter == null} onClick={() => setAccountFilter(null)} />
            {containers.map((container) => (
              <Choice
                key={container.id}
                label={container.name}
                pressed={accountFilter === container.id}
                onClick={() => setAccountFilter(container.id)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <Heading>Tax entity</Heading>
        {accountFilter == null ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ["personal", "Personal (18%)"],
                ["trust", "Trust (36%)"],
                ["taxfree", "Tax-Free (0%)"],
              ] as const
            ).map(([mode, label]) => (
              <Choice
                key={mode}
                label={label}
                pressed={inputs.taxMode === mode}
                onClick={() => setInput("taxMode", mode)}
              />
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm">
            {inputs.taxMode === "trust" ? "Trust (36%)" : "Personal (18%)"}. Tax treatment follows the selected account.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <Stat label="Inclusion" value={inputs.taxMode === "trust" ? "80%" : inputs.taxMode === "taxfree" ? "0%" : "40%"} />
          <Stat label="Effective CGT" value={fmtPct(result.effectiveCGT * 100, 0)} />
          <Stat label="Annual excl" value={result.annualExcl > 0 ? "R40k" : "—"} />
        </div>
        <button
          type="button"
          className="mt-3 w-full rounded-ledger border border-border px-3 py-2 text-left text-sm"
          aria-pressed={saTaxYearOn(inputs)}
          onClick={() => setInputs((prev) => toggleSaTaxYear(prev, new Date()))}
        >
          Align to SA tax year (rebalance Feb 28)
          <span className="mt-1 block text-xs text-muted-foreground">
            {saTaxYearOn(inputs)
              ? `Starts month ${inputs.startMonth}. First rebalance uses the February setting.`
              : "Off. Annual rebalance at month 12."}
          </span>
        </button>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Heading>Inputs</Heading>
          <button type="button" className="rounded-ledger border border-border px-3 py-1.5 text-sm" onClick={onUseCurrent}>
            {position?.collateralZar != null ? (
              <>
                Use current (<Balance text={money(position.collateralZar)} />)
              </>
            ) : (
              "Use current"
            )}
          </button>
        </div>
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          <Balance text={liveStatus} />
        </p>
        {liveNote ? <p role="status" className="mb-3 text-sm">{liveNote}</p> : null}
        <p className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground">RETURNS</p>
        <NumberField label="BTC annual growth" value={inputs.btcGrowth} step={1} suffix="%" onChange={(value) => setInput("btcGrowth", clamp(value, 0, 200))} />
        <NumberField label="Options / AMC return" value={inputs.optionsReturn} step={1} suffix="%" onChange={(value) => setInput("optionsReturn", clamp(value, 0, 200))} />
        <p className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground">LEVERAGE</p>
        <NumberField label="Loan-to-value" value={inputs.ltv} step={5} suffix="%" onChange={(value) => setInput("ltv", clamp(value, 10, 80))} />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Borrow cost source</span>
          <div className="flex gap-2">
            <Choice label="Auto (Binance)" pressed={borrowAuto} onClick={() => setBorrowAuto(true)} />
            <Choice label="Manual" pressed={!borrowAuto} onClick={() => setBorrowAuto(false)} />
          </div>
        </div>
        {borrowAuto ? (
          <p className="mb-3 text-sm">
            Borrow cost {fmtPct(inputs.borrowCost, 1)} ·{" "}
            {position?.weightedAprPct != null ? "live" : loansQuery.isPending ? "checking live loans" : "no live loan"}
          </p>
        ) : (
          <NumberField label="Borrow cost" value={inputs.borrowCost} step={0.5} suffix="%" onChange={(value) => setInput("borrowCost", clamp(value, 0, 100))} />
        )}
        <p className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground">MONEY IN</p>
        <NumberField label="Starting capital" value={inputs.startingCapital} step={100_000} money onChange={(value) => setInput("startingCapital", Math.max(0, value))} />
        <NumberField label="Monthly contribution" value={inputs.monthlyContrib} step={50_000} money onChange={(value) => setInput("monthlyContrib", Math.max(0, value))} />
        <NumberField label="Annual escalation" value={inputs.contribEscalation} step={1} suffix="%" onChange={(value) => setInput("contribEscalation", clamp(value, 0, 100))} />
        <NumberField label="Horizon" value={inputs.years} step={1} suffix=" yrs" onChange={(value) => setInput("years", clamp(Math.round(value), 1, 20))} />
      </Card>
    </>
  );

  const resultsPane = (
    <>
      <Card>
        <Heading>Exit value (net of all tax)</Heading>
        <div className="space-y-3" aria-live="polite">
          <ValueRow label="A: BTC + Lever" value={money(aNet)} tone="primary" share={shareOf(aNet, bNet)} />
          <ValueRow label="B: Pure AMC" value={money(bNet)} tone="purple" share={shareOf(bNet, aNet)} />
          <p className="text-sm">
            {winner} wins by <Balance text={money(Math.abs(aNet - bNet))} />
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="Contributed" value={<Balance text={money(lastA?.contributed ?? 0)} />} />
            <Stat label="Total tax" value={<Balance text={money(result.totTaxA)} />} />
            <Stat label="A multiple" value={multiple(aNet, lastA?.contributed ?? 0)} />
          </div>
        </div>
      </Card>

      <Card>
        <Heading>Key rates</Heading>
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="A gross" value={fmtPct(result.grossEffA, 1)} />
          <Stat label="B gross" value={fmtPct(result.grossEffB, 1)} />
          <Stat
            label="Break-even borrow"
            value={Number.isFinite(result.breakEvenBorrowPct) ? fmtPct(result.breakEvenBorrowPct, 1) : "—"}
          />
          <Stat
            label="BTC drop to liq."
            value={result.liquidationDropPct > 0 ? `${MINUS}${fmtPct(result.liquidationDropPct, 0)}` : "—"}
          />
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <Heading>Net value over time</Heading>
          <button type="button" className="rounded-ledger border border-border px-3 py-1 text-sm" onClick={() => setExpanded("chart")}>
            Expand
          </button>
        </div>
        <LeverageChart snapsA={result.snapsA} snapsB={result.snapsB} summary={summary} />
        <p className="mt-2 text-sm text-muted-foreground">
          {crossover == null
            ? "A's growth rate stays ahead of B across the full horizon."
            : `B's growth rate overtakes A from year ${crossover}.`}
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <Heading>Year by year</Heading>
          <button type="button" className="rounded-ledger border border-border px-3 py-1 text-sm" onClick={() => setExpanded("table")}>
            Expand
          </button>
        </div>
        <YearTable rowsA={result.rowsA} rowsB={result.rowsB} money={money} />
      </Card>

      <Card>
        <p className="text-xs leading-5 text-muted-foreground">
          Planning tool, not advice. Does not model BTC volatility, liquidation cascades, AMC fees, forex, or
          Section 7C. Tax math assumes SA CGT rules (40% personal / 80% trust inclusion at 45% marginal).{" "}
          {fx != null ? (
            <>
              Display currency converts at <Balance text={`R${fmtNum(fx, 2)}`} /> per US dollar from the saved snapshot.
            </>
          ) : (
            "No USD/ZAR rate was in the snapshot, so these results stay in ZAR unless a rate is returned."
          )}
        </p>
      </Card>
    </>
  );

  return (
    <section className="min-w-0">
      <div className="mb-4">
        <p className="text-xs font-semibold tracking-widest text-primary">STRATEGY SIMULATOR</p>
        <h1 className="text-2xl font-semibold tracking-tight">BTC Lever + AMC vs Pure AMC</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inputs in rand. Results follow the display currency ({currency}), which you change in the top bar.</p>
      </div>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">{inputsPane}</div>
        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[5.25rem]">{resultsPane}</div>
      </div>

      {expanded ? (
        <div role="dialog" aria-modal="true" aria-label={expanded === "table" ? "Year by year" : "Net value over time"} className="fixed inset-0 z-20 overflow-auto bg-background p-4">
          <div className="mx-auto max-w-[900px]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{expanded === "table" ? "Year by year" : "Net value over time"}</h2>
              <button type="button" className="rounded-ledger border border-border px-3 py-1 text-sm" onClick={() => setExpanded(null)}>
                Close
              </button>
            </div>
            {expanded === "chart" ? (
              <LeverageChart snapsA={result.snapsA} snapsB={result.snapsB} summary={summary} />
            ) : (
              <YearTable rowsA={result.rowsA} rowsB={result.rowsB} money={money} />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function flowSteps(
  inputs: LeverageInputs,
  money: (zar: number) => string,
  effectiveCGT: number,
): { title: string; detail: string }[] {
  const steps: { title: string; detail: string }[] = [];
  if (inputs.startingCapital > 0) {
    steps.push({
      title: "Day 1",
      detail: `A: ${money(inputs.startingCapital)} in BTC, borrow ${inputs.ltv}% (${money(inputs.startingCapital * (inputs.ltv / 100))}) into AMC. B: ${money(inputs.startingCapital)} straight into AMC.`,
    });
  }
  steps.push({
    title: "Monthly",
    detail: `${money(inputs.monthlyContrib)} per month into BTC, then borrow ${inputs.ltv}% into AMC${inputs.contribEscalation > 0 ? `, escalating ${inputs.contribEscalation}% a year` : ""}.`,
  });
  steps.push({
    title: "Annual sell",
    detail:
      effectiveCGT > 0
        ? `Sell all AMC, pay ${fmtPct(effectiveCGT * 100, 0)} CGT on gains, and repay loans.`
        : "Sell all AMC with no tax, repay loans, and reinvest the profit.",
  });
  steps.push({
    title: "Re-gear",
    detail: `Fresh loan equals ${inputs.ltv}% of total BTC.`,
  });
  return steps;
}

function shareOf(value: number, other: number): number {
  const max = Math.max(value, other, 1);
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function multiple(net: number, contributed: number): string {
  return `${fmtNum(net / Math.max(1, contributed), 1)}×`;
}

function Choice(props: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      className={
        props.pressed
          ? "rounded-ledger bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          : "rounded-ledger border border-border px-3 py-1.5 text-sm text-muted-foreground"
      }
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function Stat(props: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-ledger border border-border px-2 py-2">
      <div className="text-[10px] tracking-wide text-muted-foreground">{props.label.toUpperCase()}</div>
      <div className="mt-1 font-semibold tabular-nums">{props.value}</div>
    </div>
  );
}

function ValueRow(props: { label: string; value: string; tone: "primary" | "purple"; share: number }) {
  const color = props.tone === "primary" ? "bg-primary" : "bg-[#7c6aef]";
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm font-semibold">
        <span>{props.label}</span>
        <span className="tabular-nums">
          <Balance text={props.value} />
        </span>
      </div>
      <div className="h-2 rounded-full bg-background">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${props.share}%` }} />
      </div>
    </div>
  );
}

function YearTable(props: {
  rowsA: ReturnType<typeof compute>["rowsA"];
  rowsB: ReturnType<typeof compute>["rowsB"];
  money: (zar: number) => string;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[28rem] text-right text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left">YR</th>
            <th className="py-1">A NET</th>
            <th className="py-1">B NET</th>
            <th className="py-1">A TAX</th>
            <th className="py-1">Δ</th>
          </tr>
        </thead>
        <tbody>
          {props.rowsA.map((rowA, index) => {
            const rowB = props.rowsB[index];
            if (!rowB) return null;
            const delta = rowA.net - rowB.net;
            return (
              <tr key={rowA.year} className="border-t border-border">
                <td className="py-1 text-left">{rowA.year}</td>
                <td className="py-1 text-primary">
                  <Balance text={props.money(rowA.net)} />
                </td>
                <td className="py-1">
                  <Balance text={props.money(rowB.net)} />
                </td>
                <td className="py-1 text-danger">
                  <Balance text={props.money(rowA.amcTax)} />
                </td>
                <td className="py-1">
                  <Balance text={props.money(delta)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
  money?: boolean;
}) {
  const discreet = useDiscreet();
  const [focused, setFocused] = useState(false);
  const shown = props.money ? String(Math.round(props.value)) : String(props.value);
  const maskInput = Boolean(props.money) && discreet.hidden && !focused;
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    setDraft(shown);
  }, [shown]);
  const id = `strategy-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  function commit(): void {
    const parsed = parseDecimalInput(draft);
    if (parsed == null) {
      setDraft(shown);
      return;
    }
    props.onChange(parsed);
  }

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-semibold tracking-wide text-muted-foreground">
          {props.label}
        </label>
        <span className="text-sm tabular-nums">
          {props.money ? (
            <Balance text={formatSimMoney(props.value, "ZAR", null)} />
          ) : (
            `${fmtNum(props.value, Number.isInteger(props.value) ? 0 : 1)}${props.suffix ?? ""}`
          )}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-ledger border border-border px-3"
          aria-label={`Decrease ${props.label}`}
          onClick={() => props.onChange(props.value - props.step)}
        >
          −
        </button>
        <span className="relative min-w-0 flex-1" data-balance={props.money && discreet.enabled ? "" : undefined}>
          <input
            id={id}
            value={draft}
            inputMode="decimal"
            aria-label={maskInput ? `${props.label}, hidden` : props.label}
            className={`w-full rounded-ledger border border-border bg-background px-3 py-2 text-center ${maskInput ? "text-transparent caret-transparent" : ""}`}
            onFocus={() => setFocused(true)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
          {maskInput ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm">{DISCREET_PLACEHOLDER}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="rounded-ledger border border-border px-3"
          aria-label={`Increase ${props.label}`}
          onClick={() => props.onChange(props.value + props.step)}
        >
          +
        </button>
      </div>
    </div>
  );
}
