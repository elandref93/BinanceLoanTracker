import React from "react";
import { Lock } from "lucide-react";
import "./_group.css";
import { LOAN_DATA, priceDropPctTo, LIQUIDATION_LTV } from "./_phone";

// iOS rotates inline complications via TimelineEntry. In the mock we show three
// stacked rows so the user can see what each rotation would look like.
export function WidgetLockInline() {
  const D = LOAN_DATA;
  const worstDrop = Math.min(...D.loans.map(l => Math.abs(priceDropPctTo(l, LIQUIDATION_LTV))));
  const rotations = [
    `LTV ${D.currentLtv}% · target ${D.targetLtv}%`,
    `Liq −${worstDrop.toFixed(0)}% · ${D.loans[0].collateralAsset}`,
    `Int $${D.interest30d.toFixed(0)}/30d · 3 loans`,
  ];
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme flex flex-col gap-1 px-2">
        {rotations.map((text, i) => (
          <div key={i} className="flex items-center gap-1.5" style={{ opacity: i === 0 ? 1 : 0.45 }}>
            <Lock className="w-3 h-3 text-white/70" />
            <span className="text-[13px] text-white tabular tracking-tight whitespace-nowrap">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
