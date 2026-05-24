import React from "react";
import "./_group.css";
import { LOAN_DATA, priceDropPctTo, LIVE_PRICES, LIQUIDATION_LTV } from "./_phone";

// Variant B — "Closest to liquidation". Shows the worst-positioned loan.
export function WidgetHomeSmallRisk() {
  const D = LOAN_DATA;
  // Closest to liquidation = smallest absolute % drop needed
  const ranked = D.loans
    .map(l => ({ loan: l, drop: Math.abs(priceDropPctTo(l, LIQUIDATION_LTV)) }))
    .sort((a, b) => a.drop - b.drop);
  const worst = ranked[0];
  const price = LIVE_PRICES[worst.loan.collateralAsset] ?? 0;
  const triggerPrice = worst.loan.borrowed / (worst.loan.collateral * (LIQUIDATION_LTV / 100));

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[158px] h-[158px] rounded-[22px] p-3 flex flex-col justify-between" style={{ background: "linear-gradient(160deg, #1F1A1A 0%, #0A0A0B 100%)" }}>
        <div className="flex items-center justify-between">
          <div className="w-5 h-5 rounded-md flex items-center justify-center bg-[#FF453A22]">
            <div className="w-2 h-2 rounded-sm bg-danger" />
          </div>
          <span className="text-[9px] uppercase tracking-widest text-muted font-medium">Liq distance</span>
        </div>
        <div>
          <div className="text-[10px] text-muted uppercase tracking-widest">{worst.loan.collateralAsset} · {worst.loan.accountName.split(" ")[0]}</div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="tabular text-[36px] leading-none font-semibold text-danger">{worst.drop.toFixed(0)}<span className="text-[14px] text-muted">%</span></span>
          </div>
          <div className="text-[10px] text-muted">drop to liquidate</div>
        </div>
        <div className="rounded-md bg-[#0F0F11] px-2 py-1.5">
          <div className="flex justify-between text-[9px] tabular">
            <span className="text-muted">Now</span>
            <span className="text-primary">${price.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[9px] tabular">
            <span className="text-muted">Liq</span>
            <span className="text-danger">${triggerPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
