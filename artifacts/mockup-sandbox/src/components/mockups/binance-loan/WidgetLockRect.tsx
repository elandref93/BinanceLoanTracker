import React from "react";
import "./_group.css";
import { LOAN_DATA, priceDropPctTo, priceAtLtv, LIQUIDATION_LTV } from "./_phone";

export function WidgetLockRect() {
  const D = LOAN_DATA;
  // Pick the loan closest to liquidation for the second line
  const worst = D.loans
    .map(l => ({ l, drop: Math.abs(priceDropPctTo(l, LIQUIDATION_LTV)) }))
    .sort((a, b) => a.drop - b.drop)[0];
  const liqPrice = priceAtLtv(worst.l, LIQUIDATION_LTV);
  const targetPct = (D.targetLtv / D.liquidationLtv) * 100;
  const curPct = (D.currentLtv / D.liquidationLtv) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme w-[160px] h-[68px] rounded-[12px] px-3 py-2 flex flex-col justify-between" style={{ backgroundColor: "rgba(255,255,255,0.10)", backdropFilter: "blur(8px)" }}>
        <div className="flex items-baseline justify-between">
          <span className="tabular text-[20px] leading-none font-semibold text-white">
            {D.currentLtv}<span className="text-white/60">%</span>
          </span>
          <span className="text-[8px] uppercase tracking-[0.18em] text-white/70 font-semibold">LTV</span>
        </div>
        <div className="text-[9px] text-white/80 tabular leading-tight">
          Liq · {worst.l.collateralAsset} ${liqPrice.toLocaleString(undefined,{maximumFractionDigits:0})} <span className="text-white/60">({worst.drop.toFixed(0)}%)</span>
        </div>
        <div className="relative h-[3px] rounded-full bg-white/15">
          <div className="absolute top-0 left-0 h-full rounded-full bg-white" style={{ width: `${curPct}%` }} />
          <div className="absolute top-[-1px] bottom-[-1px] w-[2px] bg-white/70" style={{ left: `${targetPct}%` }} />
        </div>
      </div>
    </div>
  );
}
