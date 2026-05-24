import React from "react";
import "./_group.css";
import { LtvBar, LOAN_DATA, headroom } from "./_phone";

// Variant B — per-loan list (3 rows max).
export function WidgetHomeMediumLoans() {
  const D = LOAN_DATA;
  const rows = D.loans.slice(0, 3);
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[338px] h-[158px] rounded-[22px] p-3 flex flex-col gap-1.5" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] uppercase tracking-widest text-muted">Loans · LTV</span>
          <span className="tabular text-[10px] text-muted">{rows.length} active</span>
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          {rows.map(l => (
            <div key={l.id} className="rounded-md bg-[#0F0F11] px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex items-baseline gap-1.5">
                  <span className="text-[11px] font-medium text-primary">{l.collateralAsset}</span>
                  <span className="text-[9px] text-muted truncate">{l.accountName}</span>
                </div>
                <span className="tabular text-[11px] text-primary">{l.ltv}%</span>
              </div>
              <div className="mt-1"><LtvBar value={l.ltv} target={D.targetLtv} liquidation={D.liquidationLtv} height={3} /></div>
              <div className="flex justify-between mt-0.5 text-[9px] tabular text-muted">
                <span>${l.borrowed.toLocaleString()}</span>
                <span className="text-accent">+${headroom(l).toLocaleString()} room</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
