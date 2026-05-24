import React from "react";
import "./_group.css";
import { LtvBar, LOAN_DATA } from "./_phone";

export function WidgetHomeSmall() {
  const D = LOAN_DATA;
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[158px] h-[158px] rounded-[22px] p-3 flex flex-col justify-between" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
        <div className="flex items-center justify-between">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
            <div className="w-2 h-2 rounded-sm bg-accent" />
          </div>
          <span className="text-[9px] uppercase tracking-widest text-muted font-medium">LTV</span>
        </div>
        <div>
          <div className="flex items-baseline gap-0.5">
            <span className="tabular text-[44px] leading-none font-semibold text-primary">{D.currentLtv}</span>
            <span className="text-[16px] font-medium text-muted">%</span>
          </div>
          <div className="text-[10px] text-muted tabular mt-0.5">Target {D.targetLtv}%</div>
        </div>
        <LtvBar value={D.currentLtv} target={D.targetLtv} liquidation={D.liquidationLtv} height={4} />
      </div>
    </div>
  );
}
