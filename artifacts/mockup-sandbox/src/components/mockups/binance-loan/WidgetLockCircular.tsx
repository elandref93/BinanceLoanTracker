import React from "react";
import "./_group.css";
import { LOAN_DATA } from "./_phone";

export function WidgetLockCircular() {
  const D = LOAN_DATA;
  const size = 72, stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = D.currentLtv / D.liquidationLtv;
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme w-[72px] h-[72px] rounded-full flex items-center justify-center relative" style={{ backgroundColor: "rgba(255,255,255,0.10)", backdropFilter: "blur(8px)" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} />
        </svg>
        <div className="relative flex flex-col items-center">
          <span className="tabular text-[16px] leading-none font-semibold text-white">{D.currentLtv}%</span>
          <span className="text-[7px] uppercase tracking-widest text-white/70 mt-0.5">LTV</span>
        </div>
      </div>
    </div>
  );
}
