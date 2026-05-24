import React from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar, LtvGauge, LtvBar, StatusPill, LOAN_DATA } from "./_phone";

export function Dashboard() {
  const D = LOAN_DATA;
  return (
    <Phone>
      <StatusBar />
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] text-muted">Good morning, Alex</div>
            <div className="text-[10px] uppercase tracking-widest text-muted mt-1">Portfolio</div>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[28px] font-semibold tracking-tight text-primary">${D.portfolioTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <ArrowUpRight className="w-3 h-3 text-safe" />
              <span className="tabular text-[12px] text-safe font-medium">+${D.delta24h.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({D.deltaPct.toFixed(2)}%)</span>
              <span className="text-[12px] text-muted">· 24h</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-surface border border-subtle flex items-center justify-center">
            <span className="text-[12px] font-semibold text-primary">A</span>
          </div>
        </div>

        {/* Hero LTV card */}
        <div className="mt-5 rounded-2xl bg-surface border border-subtle p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted">Loan health · LTV</span>
            <StatusPill status="Healthy" />
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
          <StatTile label="Collateral" value={`$${D.totalCollateral.toLocaleString()}`} />
          <StatTile label="Borrowed" value={`$${D.totalBorrowed.toLocaleString()}`} />
          <StatTile label="Loan Equity" value={`$${D.loanEquity.toLocaleString()}`} accent />
          <StatTile label="Interest · 30d" value={`$${D.interest30d.toFixed(2)}`} />
        </div>

        {/* Active loans */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[12px] uppercase tracking-widest text-muted">Active loans</span>
            <span className="text-[12px] text-muted tabular">{D.loans.length}</span>
          </div>
          <div className="rounded-2xl bg-surface border border-subtle divide-y" style={{ borderColor: "var(--ledger-border)" }}>
            {D.loans.map(loan => (
              <div key={loan.id} className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#1F1F22] flex items-center justify-center text-[10px] font-semibold tabular text-primary">{loan.collateralAsset}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-primary">{loan.borrowAsset} / {loan.collateralAsset}</span>
                    <span className="tabular text-[13px] font-medium text-primary">${loan.borrowed.toLocaleString()}</span>
                  </div>
                  <div className="mt-2">
                    <LtvBar value={loan.ltv} target={D.targetLtv} liquidation={D.liquidationLtv} height={4} />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11px] text-muted tabular">
                    <span>LTV {loan.ltv}%</span>
                    <span>APR {loan.apr}%</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#3A3A3C]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <TabBar active="dashboard" />
      <HomeIndicator />
    </Phone>
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
