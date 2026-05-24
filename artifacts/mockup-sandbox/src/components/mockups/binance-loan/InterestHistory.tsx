import React from "react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar, LOAN_DATA, ACCOUNTS, useCurrency, fmtMoney, CurrencyToggle, USD_ZAR_RATE } from "./_phone";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const RANGES = ["7D", "30D", "90D", "All"] as const;
type Range = typeof RANGES[number];
type GroupBy = "loan" | "account";

// Build a stacked series per loan, summing to the per-range total.
function buildStackedSeries(D: typeof LOAN_DATA, range: Range, c: "USD" | "ZAR") {
  const labels: string[] =
    range === "7D" ? ["May 18", "May 19", "May 20", "May 21", "May 22", "May 23", "May 24"]
    : range === "30D" ? Array.from({ length: 15 }, (_, i) => `D-${(15 - i) * 2}`)
    : range === "90D" ? Array.from({ length: 18 }, (_, i) => `D-${(18 - i) * 5}`)
    : ["Jan", "Feb", "Mar", "Apr", "May"];
  const total = range === "7D" ? D.interest7d : range === "30D" ? D.interest30d : range === "90D" ? D.interest90d : D.interestAll;
  const fx = c === "USD" ? 1 : USD_ZAR_RATE;
  // Per-loan share derived from interest30d as a stable proxy
  const total30 = D.loans.reduce((s, l) => s + l.interest30d, 0);
  return labels.map((d, i) => {
    const t = (i + 1) / labels.length;
    const factor = (0.55 * t + 0.45 * Math.pow(t, 1.8));
    const point: Record<string, string | number> = { d };
    D.loans.forEach(loan => {
      const share = loan.interest30d / total30;
      point[loan.id] = Number((total * factor * share * fx).toFixed(2));
    });
    return point;
  });
}

const COLORS = ["#00F0FF", "#A855F7", "#FFB020"];

export function InterestHistory() {
  const [range, setRange] = React.useState<Range>("30D");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("loan");
  const { c } = useCurrency();
  const D = LOAN_DATA;
  const totalForRange = range === "7D" ? D.interest7d : range === "30D" ? D.interest30d : range === "90D" ? D.interest90d : D.interestAll;
  const days = range === "7D" ? 7 : range === "30D" ? 30 : range === "90D" ? 90 : 365;

  // Weighted-average APR (by borrowed amount)
  const weightedApr = D.loans.reduce((s, l) => s + l.apr * l.borrowed, 0) / D.totalBorrowed;

  // Portfolio gain for the same window (mock values)
  const portfolioGain = range === "7D" ? 482.10 : range === "30D" ? 1284.17 : range === "90D" ? 4120.55 : 9870.12;
  const net = portfolioGain - totalForRange;

  const series = React.useMemo(() => buildStackedSeries(D, range, c), [range, c, D]);
  const symbol = c === "USD" ? "$" : "R";

  // Grouped rows
  const groupedRows = React.useMemo(() => {
    if (groupBy === "loan") return D.loans.map(l => ({ key: l.id, label: `${l.borrowAsset} / ${l.collateralAsset}`, sub: l.accountName, value: l.interest30d, meta: `APR ${l.apr}%` }));
    return ACCOUNTS.map(a => {
      const i = a.loans.reduce((s, l) => s + l.interest30d, 0);
      const apr = a.loans.reduce((s, l) => s + l.apr * l.borrowed, 0) / a.loans.reduce((s, l) => s + l.borrowed, 0);
      return { key: a.id, label: a.name, sub: `${a.loans.length} loan${a.loans.length === 1 ? "" : "s"}`, value: i, meta: `APR ${apr.toFixed(2)}% avg` };
    });
  }, [groupBy, D.loans]);
  const groupedTotal = groupedRows.reduce((s, r) => s + r.value, 0);

  return (
    <Phone>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 shrink-0 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold tracking-tight text-primary">Interest</h1>
        <CurrencyToggle />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-surface border border-subtle">
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} className="py-1.5 text-[12px] font-medium rounded-lg transition-colors"
              style={{ backgroundColor: range === r ? "var(--ledger-surface-elevated)" : "transparent", color: range === r ? "var(--ledger-text)" : "var(--ledger-muted)" }}
            >{r}</button>
          ))}
        </div>

        {/* Total + weighted APR */}
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted">Total interest · {range}</div>
            <div className="tabular text-[36px] font-semibold tracking-tight text-primary mt-1 leading-none">{fmtMoney(totalForRange, c)}</div>
            <div className="text-[12px] text-muted tabular mt-1">avg {fmtMoney(totalForRange / days, c)}/day</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted">Wtd APR</div>
            <div className="tabular text-[18px] font-semibold text-primary leading-none mt-1">{weightedApr.toFixed(2)}%</div>
          </div>
        </div>

        {/* Interest vs portfolio gain */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] uppercase tracking-widest text-muted">Cost vs gain · {range}</span>
            <span className="tabular text-[11px] font-semibold" style={{ color: net >= 0 ? "var(--ledger-safe)" : "var(--ledger-danger)" }}>
              Net {net >= 0 ? "+" : ""}{fmtMoney(net, c)}
            </span>
          </div>
          <CompareBar
            negative={{ label: "Interest paid", value: totalForRange, color: "var(--ledger-danger)" }}
            positive={{ label: "Portfolio gain", value: portfolioGain, color: "var(--ledger-safe)" }}
            symbol={symbol}
            c={c}
          />
        </div>

        {/* Stacked area chart */}
        <div className="mt-4 h-[180px] rounded-2xl bg-surface border border-subtle p-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <defs>
                {D.loans.map((l, i) => (
                  <linearGradient key={l.id} id={`g-${l.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis dataKey="d" tick={{ fill: "#5A5A5F", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fill: "#5A5A5F", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v}`} />
              <Tooltip contentStyle={{ backgroundColor: "#1C1C1E", border: "1px solid #2C2C2E", borderRadius: 8, fontSize: 11 }} labelStyle={{ color: "#8E8E93" }} />
              {D.loans.map((l, i) => (
                <Area key={l.id} type="monotone" dataKey={l.id} stackId="1" stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} fill={`url(#g-${l.id})`} name={`${l.borrowAsset}/${l.collateralAsset}`} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 px-1">
          {D.loans.map((l, i) => (
            <div key={l.id} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-[10px] text-muted">{l.borrowAsset}/{l.collateralAsset}</span>
            </div>
          ))}
        </div>

        {/* Group-by toggle + list */}
        <div className="mt-5 flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] uppercase tracking-widest text-muted">By {groupBy}</span>
          <div className="flex p-0.5 rounded-lg bg-surface border border-subtle">
            {(["loan", "account"] as const).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} className="px-2.5 py-1 text-[10px] font-semibold rounded-md tracking-wide"
                style={{ backgroundColor: groupBy === g ? "var(--ledger-surface-elevated)" : "transparent", color: groupBy === g ? "var(--ledger-text)" : "var(--ledger-muted)" }}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-surface border border-subtle">
          {groupedRows.map((row, i) => {
            const share = (row.value / groupedTotal) * 100;
            return (
              <div key={row.key} className={`p-4 ${i < groupedRows.length - 1 ? "border-b border-subtle" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-primary truncate">{row.label}</div>
                    <div className="text-[10px] text-muted truncate">{row.sub}</div>
                  </div>
                  <span className="tabular text-[13px] font-medium text-primary shrink-0">{fmtMoney(row.value, c)}</span>
                </div>
                <div className="mt-2 relative h-1 rounded-full bg-[#1F1F22]">
                  <div className="absolute top-0 left-0 h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[11px] text-muted tabular">
                  <span>{row.meta}</span>
                  <span>{share.toFixed(1)}% of total</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TabBar active="history" />
      <HomeIndicator />
    </Phone>
  );
}

function CompareBar({ negative, positive, symbol, c }: { negative: { label: string; value: number; color: string }; positive: { label: string; value: number; color: string }; symbol: string; c: "USD" | "ZAR" }) {
  const max = Math.max(negative.value, positive.value);
  return (
    <div className="space-y-2.5">
      {[positive, negative].map(item => (
        <div key={item.label}>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted">{item.label}</span>
            <span className="tabular text-primary">{symbol}{(c === "USD" ? item.value : item.value * USD_ZAR_RATE).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#1F1F22] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
