import React from "react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar, LOAN_DATA, useCurrency, fmtMoney, CurrencyToggle } from "./_phone";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const RANGES = ["7D", "30D", "90D", "All"] as const;
type Range = typeof RANGES[number];

function buildSeries(total: number, points: number, labels: string[]): { d: string; v: number }[] {
  const out: { d: string; v: number }[] = [];
  for (let i = 0; i < points; i++) {
    const t = (i + 1) / points;
    const v = total * (0.55 * t + 0.45 * Math.pow(t, 1.8));
    out.push({ d: labels[i] ?? "", v: Number(v.toFixed(2)) });
  }
  return out;
}

const LABELS: Record<Range, string[]> = {
  "7D":  ["May 18", "May 19", "May 20", "May 21", "May 22", "May 23", "May 24"],
  "30D": Array.from({ length: 15 }, (_, i) => `D-${(15 - i) * 2}`),
  "90D": Array.from({ length: 18 }, (_, i) => `D-${(18 - i) * 5}`),
  "All": ["Jan", "Feb", "Mar", "Apr", "May"],
};

export function InterestHistory() {
  const [range, setRange] = React.useState<Range>("30D");
  const { c } = useCurrency();
  const D = LOAN_DATA;
  const totalForRange = range === "7D" ? D.interest7d : range === "30D" ? D.interest30d : range === "90D" ? D.interest90d : D.interestAll;
  const series = React.useMemo(
    () => buildSeries(c === "USD" ? totalForRange : totalForRange * 18.45, LABELS[range].length, LABELS[range]),
    [range, totalForRange, c]
  );
  const days = range === "7D" ? 7 : range === "30D" ? 30 : range === "90D" ? 90 : 365;
  const symbol = c === "USD" ? "$" : "R";

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
            <button
              key={r}
              onClick={() => setRange(r)}
              className="py-1.5 text-[12px] font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: range === r ? "var(--ledger-surface-elevated)" : "transparent",
                color: range === r ? "var(--ledger-text)" : "var(--ledger-muted)",
              }}
            >{r}</button>
          ))}
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-widest text-muted">Total interest · {range}</div>
          <div className="tabular text-[40px] font-semibold tracking-tight text-primary mt-1">{fmtMoney(totalForRange, c)}</div>
          <div className="text-[12px] text-muted tabular">avg {fmtMoney(totalForRange / days, c)}/day</div>
        </div>

        <div className="mt-5 h-[180px] rounded-2xl bg-surface border border-subtle p-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00F0FF" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#00F0FF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d" tick={{ fill: "#5A5A5F", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fill: "#5A5A5F", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${symbol}${v}`} />
              <Tooltip contentStyle={{ backgroundColor: "#1C1C1E", border: "1px solid #2C2C2E", borderRadius: 8, fontSize: 11 }} labelStyle={{ color: "#8E8E93" }} />
              <Area type="monotone" dataKey="v" stroke="#00F0FF" strokeWidth={2} fill="url(#grad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-widest text-muted mb-2 px-1">By loan</div>
          <div className="rounded-2xl bg-surface border border-subtle">
            {D.loans.map((loan, i) => {
              const share = (loan.interest30d / D.interest30d) * 100;
              return (
                <div key={loan.id} className={`p-4 ${i < D.loans.length - 1 ? "border-b border-subtle" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-primary truncate">{loan.borrowAsset} / {loan.collateralAsset}</div>
                      <div className="text-[10px] text-muted truncate">{loan.accountName}</div>
                    </div>
                    <span className="tabular text-[13px] font-medium text-primary shrink-0">{fmtMoney(loan.interest30d, c)}</span>
                  </div>
                  <div className="mt-2 relative h-1 rounded-full bg-[#1F1F22]">
                    <div className="absolute top-0 left-0 h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px] text-muted tabular">
                    <span>APR {loan.apr}%</span>
                    <span>{share.toFixed(1)}% of total</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <TabBar active="history" />
      <HomeIndicator />
    </Phone>
  );
}
