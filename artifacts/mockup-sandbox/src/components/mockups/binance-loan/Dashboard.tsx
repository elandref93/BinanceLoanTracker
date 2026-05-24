import React from "react";
import { ArrowUpRight, ChevronRight, AlertTriangle } from "lucide-react";
import "./_group.css";
import {
  Phone, StatusBar, HomeIndicator, TabBar, LtvGauge, LtvBar, StatusPill,
  ACCOUNTS, aggregate, headroom, useCurrency, fmtMoney, CurrencyToggle,
  priceDropPctTo, priceAtLtv, LIVE_PRICES, LIQUIDATION_LTV,
} from "./_phone";

type Range = "24h" | "7d" | "30d";

export function Dashboard() {
  const [scope, setScope] = React.useState<string>("all");
  const [range, setRange] = React.useState<Range>("24h");
  const [drop, setDrop] = React.useState<number>(0);
  const { c } = useCurrency();

  const accountsInScope = scope === "all" ? ACCOUNTS : ACCOUNTS.filter(a => a.id === scope);
  const D = aggregate(accountsInScope);
  const status: "Healthy" | "Warning" | "Danger" =
    D.currentLtv < D.targetLtv ? "Healthy" : D.currentLtv < D.liquidationLtv * 0.92 ? "Warning" : "Danger";

  const delta = range === "24h" ? { value: 1284.17, pct: 1.04 } : range === "7d" ? { value: 4120.55, pct: 3.42 } : { value: 9870.12, pct: 8.61 };

  // Per-asset distance to liquidation, ranked riskiest first
  const distances = D.loans
    .map(l => ({ loan: l, drop: priceDropPctTo(l, LIQUIDATION_LTV), price: LIVE_PRICES[l.collateralAsset] ?? 0, liq: priceAtLtv(l, LIQUIDATION_LTV) }))
    .sort((a, b) => Math.abs(a.drop) - Math.abs(b.drop));

  // What-if: LTV if every collateral price drops by `drop`%
  const simulatedCollateral = D.totalCollateral * (1 + drop / 100);
  const simulatedLtv = simulatedCollateral > 0 ? Math.round((D.totalBorrowed / simulatedCollateral) * 100) : 0;
  const simStatus: "Healthy" | "Warning" | "Danger" =
    simulatedLtv < D.targetLtv ? "Healthy" : simulatedLtv < D.liquidationLtv * 0.92 ? "Warning" : "Danger";
  const simColor = simStatus === "Healthy" ? "var(--ledger-safe)" : simStatus === "Warning" ? "var(--ledger-warning)" : "var(--ledger-danger)";

  return (
    <Phone>
      <StatusBar />
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4">
        {/* Hero */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[12px] text-muted">Good morning, Alex</div>
            <div className="text-[10px] uppercase tracking-widest text-muted mt-1">Portfolio</div>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[28px] font-semibold tracking-tight text-primary">{fmtMoney(D.portfolioTotal, c)}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-safe" />
              <span className="tabular text-[12px] text-safe font-medium">+{fmtMoney(delta.value, c)} ({delta.pct.toFixed(2)}%)</span>
              <div className="flex gap-0.5 ml-1.5">
                {(["24h", "7d", "30d"] as const).map(r => (
                  <button key={r} onClick={() => setRange(r)} className="text-[10px] px-1.5 py-0.5 rounded font-semibold tabular tracking-wide" style={{
                    backgroundColor: range === r ? "var(--ledger-surface-elevated)" : "transparent",
                    color: range === r ? "var(--ledger-text)" : "var(--ledger-muted)",
                  }}>{r}</button>
                ))}
              </div>
            </div>
          </div>
          <CurrencyToggle />
        </div>

        {/* Account chips with LTV pills */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <Chip label="All" ltv={aggregate(ACCOUNTS).currentLtv} active={scope === "all"} onClick={() => setScope("all")} />
          {ACCOUNTS.map(a => {
            const ag = aggregate([a]);
            return <Chip key={a.id} label={a.name} ltv={ag.currentLtv} active={scope === a.id} onClick={() => setScope(a.id)} />;
          })}
        </div>

        {/* Hero LTV gauge */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted">
              {scope === "all" ? "All accounts · LTV" : `${ACCOUNTS.find(a => a.id === scope)?.name} · LTV`}
            </span>
            <StatusPill status={status} />
          </div>
          <div className="flex flex-col items-center mt-2">
            <LtvGauge value={D.currentLtv} target={D.targetLtv} liquidation={D.liquidationLtv} size={240} strokeWidth={16} />
            <div className="-mt-12 flex items-baseline gap-1">
              <span className="tabular text-[56px] leading-none font-semibold text-primary">{D.currentLtv}</span>
              <span className="text-[20px] font-medium text-muted">%</span>
            </div>
            <div className="text-[12px] text-muted mt-1 tabular">Target {D.targetLtv}% · Liquidation {D.liquidationLtv}%</div>
          </div>
        </div>

        {/* Distance to liquidation per asset */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              <span className="text-[11px] uppercase tracking-widest text-muted">Distance to liquidation</span>
            </div>
            <span className="text-[10px] text-muted tabular">collateral price drop</span>
          </div>
          <div className="space-y-2">
            {distances.map((d, i) => (
              <div key={d.loan.id} className="flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`tabular text-[10px] w-4 text-right ${i === 0 ? "text-danger" : "text-muted"}`}>#{i + 1}</span>
                  <span className="text-[12px] text-primary font-medium">{d.loan.collateralAsset}</span>
                  <span className="text-[10px] text-muted truncate">· {d.loan.accountName}</span>
                </div>
                <div className="text-right">
                  <div className={`tabular text-[14px] font-semibold ${Math.abs(d.drop) < 20 ? "text-danger" : Math.abs(d.drop) < 30 ? "text-warning" : "text-safe"}`}>{d.drop.toFixed(1)}%</div>
                  <div className="text-[9px] text-muted tabular">to {fmtMoney(d.liq, c, 0)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stat strip (horizontal scroll) */}
        <div className="mt-4 -mx-5 px-5 flex gap-3 overflow-x-auto pb-1">
          <StatPill label="Collateral" value={fmtMoney(D.totalCollateral, c, 0)} />
          <StatPill label="Borrowed" value={fmtMoney(D.totalBorrowed, c, 0)} />
          <StatPill label="Loan Equity" value={fmtMoney(D.loanEquity, c, 0)} accent />
          <StatPill label="Interest · 30d" value={fmtMoney(D.interest30d, c)} />
          <StatPill label="Headroom" value={`+${fmtMoney(D.totalHeadroom, c, 0)}`} />
        </div>

        {/* What-if simulator */}
        <div className="mt-5 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted">What if · price drop</span>
            <span className="tabular text-[12px] text-muted">{drop}%</span>
          </div>
          <input
            type="range"
            min={-50}
            max={0}
            step={1}
            value={drop}
            onChange={e => setDrop(Number(e.target.value))}
            className="w-full mt-3 accent-[#00F0FF]"
          />
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Simulated LTV</div>
              <div className="tabular text-[24px] font-semibold leading-none mt-1" style={{ color: simColor }}>{simulatedLtv}%</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted">Status</div>
              <div className="mt-1"><StatusPill status={simStatus} /></div>
            </div>
          </div>
        </div>

        {/* Active loans */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[12px] uppercase tracking-widest text-muted">Active loans</span>
            <span className="text-[12px] text-muted tabular">{D.loans.length}</span>
          </div>
          <div className="rounded-2xl bg-surface border border-subtle divide-y" style={{ borderColor: "var(--ledger-border)" }}>
            {D.loans.map(loan => {
              const h = headroom(loan, D.targetLtv);
              return (
                <div key={loan.id} className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#1F1F22] flex items-center justify-center text-[10px] font-semibold tabular text-primary shrink-0">{loan.collateralAsset}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-primary truncate">{loan.borrowAsset} / {loan.collateralAsset}</div>
                        <div className="text-[10px] text-muted truncate">{loan.accountName}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular text-[13px] font-medium text-primary">{fmtMoney(loan.borrowed, c, 0)}</div>
                        <div className="tabular text-[10px] text-accent">+{fmtMoney(h, c, 0)} room</div>
                      </div>
                    </div>
                    <div className="mt-2"><LtvBar value={loan.ltv} target={D.targetLtv} liquidation={D.liquidationLtv} height={4} /></div>
                    <div className="flex justify-between mt-1.5 text-[11px] text-muted tabular">
                      <span>LTV {loan.ltv}%</span>
                      <span>APR {loan.apr}%</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#3A3A3C] shrink-0" />
                </div>
              );
            })}
          </div>
          <div className="text-center text-[10px] text-muted mt-2 tracking-widest uppercase">Tap a loan for details</div>
        </div>
      </div>
      <TabBar active="dashboard" />
      <HomeIndicator />
    </Phone>
  );
}

function Chip({ label, ltv, active, onClick }: { label: string; ltv: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 rounded-full border text-left transition-colors flex items-center gap-2"
      style={{
        backgroundColor: active ? "var(--ledger-accent-muted)" : "var(--ledger-surface)",
        borderColor: active ? "var(--ledger-accent)" : "var(--ledger-border)",
      }}
    >
      <div>
        <div className="text-[12px] font-medium leading-tight" style={{ color: active ? "var(--ledger-accent)" : "var(--ledger-text)" }}>{label}</div>
        <div className="text-[9px] text-muted tabular tracking-wide leading-none mt-0.5">LTV {ltv}%</div>
      </div>
    </button>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="shrink-0 min-w-[120px] rounded-xl bg-surface border border-subtle px-3.5 py-2.5">
      <div className="text-[9px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular text-[16px] font-semibold mt-1 ${accent ? "text-accent" : "text-primary"}`}>{value}</div>
    </div>
  );
}
