import React from "react";
import "./_group.css";
import { LOAN_DATA } from "./_phone";

export function WidgetLockRect() {
  const D = LOAN_DATA;
  const targetPct = (D.targetLtv / D.liquidationLtv) * 100;
  const curPct = (D.currentLtv / D.liquidationLtv) * 100;
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme w-[160px] h-[68px] rounded-[12px] px-3 py-2 flex flex-col justify-between" style={{ backgroundColor: "rgba(255,255,255,0.10)", backdropFilter: "blur(8px)" }}>
        <div className="text-[8px] uppercase tracking-[0.18em] text-white/80 font-semibold">LEDGER · LTV</div>
        <div className="tabular text-[22px] leading-none font-semibold text-white">
          {D.currentLtv}<span className="text-white/60">%</span> <span className="text-white/40 text-[14px]">/ {D.targetLtv}%</span>
        </div>
        <div className="relative h-[3px] rounded-full bg-white/15">
          <div className="absolute top-0 left-0 h-full rounded-full bg-white" style={{ width: `${curPct}%` }} />
          <div className="absolute top-[-1px] bottom-[-1px] w-[2px] bg-white/70" style={{ left: `${targetPct}%` }} />
        </div>
      </div>
    </div>
  );
}
