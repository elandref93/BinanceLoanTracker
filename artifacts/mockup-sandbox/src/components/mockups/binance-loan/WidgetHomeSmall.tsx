import React from "react";
import "./_group.css";
import { LtvBar, LOAN_DATA, aggLtvHistory } from "./_phone";

export function WidgetHomeSmall() {
  const D = LOAN_DATA;
  const spark = aggLtvHistory(D.loans, 7);
  const min = Math.min(...spark) - 1, max = Math.max(...spark) + 1;
  const w = 134, h = 28;
  const pts = spark.map((v, i) => {
    const x = (i / (spark.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[158px] h-[158px] rounded-[22px] p-3 flex flex-col justify-between relative overflow-hidden" style={{ background: "linear-gradient(160deg, #1C1C1E 0%, #0A0A0B 100%)" }}>
        <div className="flex items-center justify-between relative z-10">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
            <div className="w-2 h-2 rounded-sm bg-accent" />
          </div>
          <span className="text-[9px] uppercase tracking-widest text-muted font-medium">All · LTV</span>
        </div>
        {/* Sparkline behind number */}
        <svg className="absolute left-3 right-3" style={{ top: 56, opacity: 0.35 }} width="calc(100% - 24px)" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="ssg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00F0FF" stopOpacity="0.5" /><stop offset="100%" stopColor="#00F0FF" stopOpacity="0" /></linearGradient>
          </defs>
          <polyline points={pts} fill="none" stroke="#00F0FF" strokeWidth="1.5" />
          <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#ssg)" />
        </svg>
        <div className="relative z-10">
          <div className="flex items-baseline gap-0.5">
            <span className="tabular text-[44px] leading-none font-semibold text-primary">{D.currentLtv}</span>
            <span className="text-[16px] font-medium text-muted">%</span>
          </div>
          <div className="text-[10px] text-muted tabular mt-0.5">7d · target {D.targetLtv}%</div>
        </div>
        <div className="relative z-10"><LtvBar value={D.currentLtv} target={D.targetLtv} liquidation={D.liquidationLtv} height={4} /></div>
      </div>
    </div>
  );
}
