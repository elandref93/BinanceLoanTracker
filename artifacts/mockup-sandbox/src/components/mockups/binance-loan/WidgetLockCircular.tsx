import React from "react";
import "./_group.css";
import { LOAN_DATA, priceDropPctTo, LIQUIDATION_LTV } from "./_phone";

export function WidgetLockCircular() {
  const D = LOAN_DATA;
  const size = 72, stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = D.currentLtv / D.liquidationLtv;
  // Position of the liquidation tick on the ring (full circle = 100% of liquidation)
  const liqAngle = -90 + (D.liquidationLtv / D.liquidationLtv) * 360; // = 270 → exactly the start
  const tickRad = (liqAngle * Math.PI) / 180;
  const tx = size / 2 + r * Math.cos(tickRad);
  const ty = size / 2 + r * Math.sin(tickRad);
  // Target tick
  const targetAngle = -90 + (D.targetLtv / D.liquidationLtv) * 360;
  const targetRad = (targetAngle * Math.PI) / 180;
  const ttx = size / 2 + r * Math.cos(targetRad);
  const tty = size / 2 + r * Math.sin(targetRad);

  // Closest-to-liquidation % drop, shown under the number
  const worstDrop = Math.min(...D.loans.map(l => Math.abs(priceDropPctTo(l, LIQUIDATION_LTV))));

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme w-[72px] h-[72px] rounded-full flex items-center justify-center relative" style={{ backgroundColor: "rgba(255,255,255,0.10)", backdropFilter: "blur(8px)" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute" }}>
          <g style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} />
          </g>
          {/* Target tick (light) */}
          <circle cx={ttx} cy={tty} r={1.5} fill="rgba(255,255,255,0.85)" />
          {/* Liquidation tick (strong) */}
          <circle cx={tx} cy={ty} r={1.8} fill="white" />
        </svg>
        <div className="relative flex flex-col items-center leading-none">
          <span className="tabular text-[15px] font-semibold text-white">{D.currentLtv}%</span>
          <span className="tabular text-[8px] text-white/70 mt-0.5">−{worstDrop.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
