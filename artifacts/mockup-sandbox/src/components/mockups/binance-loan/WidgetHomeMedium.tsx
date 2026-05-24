import React from "react";
import "./_group.css";
import { LtvRing, StatusPill, LOAN_DATA, priceDropPctTo, LIQUIDATION_LTV } from "./_phone";

export function WidgetHomeMedium() {
  const D = LOAN_DATA;
  // Per-asset distance-to-liquidation summary, sorted by riskiest first
  const distances = D.loans
    .map(l => ({ asset: l.collateralAsset, drop: priceDropPctTo(l, LIQUIDATION_LTV) }))
    .sort((a, b) => Math.abs(a.drop) - Math.abs(b.drop))
    .slice(0, 3);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[338px] h-[158px] rounded-[22px] p-4 flex items-center gap-4 relative" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
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
            <span className="text-[10px] uppercase tracking-widest text-muted">All accounts</span>
            <StatusPill status="Healthy" />
          </div>
          <div className="mt-2 space-y-1.5">
            <MetaRow label="Equity" value={`$${D.loanEquity.toLocaleString()}`} />
            <MetaRow label="Int · 30d" value={`$${D.interest30d.toFixed(2)}`} />
            <div className="border-t border-subtle pt-1.5 mt-0.5">
              <div className="text-[9px] uppercase tracking-widest text-muted mb-0.5">Liquidation</div>
              <div className="flex gap-2">
                {distances.map(d => (
                  <span key={d.asset} className="tabular text-[10px]">
                    <span className="text-muted">{d.asset}</span> <span className="text-danger">{d.drop.toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* App-Intent currency toggle pill (iOS 17+) — mock visual only */}
        <div className="absolute bottom-2 right-3 flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-[#0F0F11] border border-subtle">
          <span className="text-[8px] font-bold tabular px-1 rounded-sm" style={{ backgroundColor: "var(--ledger-surface-elevated)", color: "var(--ledger-text)" }}>$</span>
          <span className="text-[8px] font-bold tabular px-1 text-muted">R</span>
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
