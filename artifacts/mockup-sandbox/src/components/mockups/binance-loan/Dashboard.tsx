import React from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import "./_group.css";
import {
  Phone, StatusBar, HomeIndicator, TabBar, LtvGauge, LtvBar, StatusPill,
  ACCOUNTS, aggregate, headroom, useCurrency, fmtMoney, CurrencyToggle,
} from "./_phone";

export function Dashboard() {
  const [scope, setScope] = React.useState<string>("all"); // "all" | account.id
  const { c } = useCurrency();

  const accountsInScope = scope === "all" ? ACCOUNTS : ACCOUNTS.filter(a => a.id === scope);
  const D = aggregate(accountsInScope);
  const status: "Healthy" | "Warning" | "Danger" =
    D.currentLtv < D.targetLtv ? "Healthy" : D.currentLtv < D.liquidationLtv * 0.92 ? "Warning" : "Danger";

  return (
    <Phone>
      <StatusBar />
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[12px] text-muted">Good morning, Alex</div>
            <div className="text-[10px] uppercase tracking-widest text-muted mt-1">Portfolio</div>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[28px] font-semibold tracking-tight text-primary">{fmtMoney(D.portfolioTotal, c)}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-safe" />
              <span className="tabular text-[12px] text-safe font-medium">+{fmtMoney(1284.17, c)} ({1.04}%)</span>
              <span className="text-[12px] text-muted">· 24h</span>
            </div>
          </div>
          <CurrencyToggle />
        </div>

        {/* Account filter chips */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <Chip label="All" sub={`${ACCOUNTS.length} accts`} active={scope === "all"} onClick={() => setScope("all")} />
          {ACCOUNTS.map(a => (
            <Chip key={a.id} label={a.name} sub={`${a.loans.length} loan${a.loans.length === 1 ? "" : "s"}`} active={scope === a.id} onClick={() => setScope(a.id)} />
          ))}
        </div>

        {/* Hero LTV card */}
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

        {/* Stat tiles */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <StatTile label="Collateral" value={fmtMoney(D.totalCollateral, c, 0)} />
          <StatTile label="Borrowed" value={fmtMoney(D.totalBorrowed, c, 0)} />
          <StatTile label="Loan Equity" value={fmtMoney(D.loanEquity, c, 0)} accent />
          <StatTile label="Interest · 30d" value={fmtMoney(D.interest30d, c)} />
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
                    <div className="mt-2">
                      <LtvBar value={loan.ltv} target={D.targetLtv} liquidation={D.liquidationLtv} height={4} />
                    </div>
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
        </div>
      </div>
      <TabBar active="dashboard" />
      <HomeIndicator />
    </Phone>
  );
}

function Chip({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 rounded-full border text-left transition-colors"
      style={{
        backgroundColor: active ? "var(--ledger-accent-muted)" : "var(--ledger-surface)",
        borderColor: active ? "var(--ledger-accent)" : "var(--ledger-border)",
      }}
    >
      <div className="text-[12px] font-medium" style={{ color: active ? "var(--ledger-accent)" : "var(--ledger-text)" }}>{label}</div>
      <div className="text-[9px] text-muted tabular tracking-wide">{sub}</div>
    </button>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-surface border border-subtle p-3.5">
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular text-[18px] font-semibold mt-1 ${accent ? "text-accent" : "text-primary"}`}>{value}</div>
    </div>
  );
}
