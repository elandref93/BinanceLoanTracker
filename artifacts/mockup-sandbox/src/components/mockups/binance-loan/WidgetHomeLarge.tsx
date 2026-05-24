import React from "react";
import "./_group.css";
import { LtvRing, LtvBar, StatusPill, LOAN_DATA, headroom, aggLtvHistory } from "./_phone";

export function WidgetHomeLarge() {
  const D = LOAN_DATA;
  const spark = aggLtvHistory(D.loans, 7);
  const sMin = Math.min(...spark), sMax = Math.max(...spark);
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[338px] h-[354px] rounded-[22px] p-4 flex flex-col gap-3" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
        {/* Top: ring + status */}
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <LtvRing value={D.currentLtv} target={D.targetLtv} liquidation={D.liquidationLtv} size={90} strokeWidth={8} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="tabular text-[22px] leading-none font-semibold text-primary">{D.currentLtv}%</span>
              <span className="text-[8px] uppercase tracking-widest text-muted mt-0.5">LTV</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-muted">All accounts</span>
              <StatusPill status="Healthy" />
            </div>
            <div className="mt-1.5 tabular text-[15px] font-semibold text-primary">${D.loanEquity.toLocaleString()}</div>
            <div className="text-[10px] text-muted tabular">Loan equity · target {D.targetLtv}%</div>
            {/* Labeled sparkline */}
            <div className="mt-1.5">
              <div className="flex items-center justify-between text-[8px] tabular text-muted">
                <span>LTV · 7d</span>
                <span>{sMin.toFixed(0)}% – {sMax.toFixed(0)}%</span>
              </div>
              <div className="h-5"><Spark data={spark} /></div>
            </div>
          </div>
        </div>

        {/* Loans — per-loan headroom inline */}
        <div className="text-[9px] uppercase tracking-widest text-muted mt-1">Active loans</div>
        <div className="space-y-2">
          {D.loans.map(loan => (
            <div key={loan.id} className="rounded-lg bg-[#0F0F11] p-2.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-primary truncate">{loan.borrowAsset} / {loan.collateralAsset}</div>
                  <div className="text-[9px] text-muted truncate">{loan.accountName}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular text-[11px] text-primary">${loan.borrowed.toLocaleString()}</div>
                  <div className="tabular text-[9px] text-accent">+${headroom(loan).toLocaleString()} room</div>
                </div>
              </div>
              <div className="mt-1.5"><LtvBar value={loan.ltv} target={D.targetLtv} liquidation={D.liquidationLtv} height={3} /></div>
              <div className="flex justify-between mt-1 text-[9px] text-muted tabular">
                <span>LTV {loan.ltv}%</span>
                <span>APR {loan.apr}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-auto pt-1 border-t border-subtle">
          <span className="text-[9px] text-muted tabular">Updated 2m ago · tap to open</span>
          <span className="tabular text-[10px] text-muted">${LOAN_DATA.portfolioTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const min = Math.min(...data), max = Math.max(...data);
  const w = 140, h = 20;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--ledger-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
