import React from "react";
import "./_group.css";
import { LtvRing, StatusPill, LOAN_DATA } from "./_phone";

export function WidgetHomeMedium() {
  const D = LOAN_DATA;
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[338px] h-[158px] rounded-[22px] p-4 flex items-center gap-4" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
        {/* Left: ring */}
        <div className="relative shrink-0">
          <LtvRing value={D.currentLtv} target={D.targetLtv} liquidation={D.liquidationLtv} size={110} strokeWidth={9} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tabular text-[28px] leading-none font-semibold text-primary">{D.currentLtv}<span className="text-[14px] text-muted">%</span></span>
            <span className="text-[9px] uppercase tracking-widest text-muted mt-0.5">LTV</span>
          </div>
        </div>
        {/* Right: meta */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted">Ledger</span>
            <StatusPill status="Healthy" />
          </div>
          <div className="mt-3 space-y-2.5">
            <MetaRow label="Equity" value={`$${D.loanEquity.toLocaleString()}`} />
            <MetaRow label="Int · 30d" value={`$${D.interest30d.toFixed(2)}`} />
            <MetaRow label="Loans" value={`${D.loans.length}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="tabular text-[13px] font-medium text-primary">{value}</span>
    </div>
  );
}
