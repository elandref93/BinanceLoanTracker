import React from "react";
import { ArrowUpRight } from "lucide-react";
import "./_group.css";
import { LOAN_DATA, nextAction } from "./_phone";

// Variant C — "Next action". Shows the single most useful nudge.
export function WidgetHomeMediumAction() {
  const D = LOAN_DATA;
  const action = nextAction(D.loans);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="ledger-theme w-[338px] h-[158px] rounded-[22px] p-4 flex flex-col justify-between" style={{ background: "linear-gradient(160deg, #001819 0%, #0A0A0B 100%)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
              <ArrowUpRight className="w-3.5 h-3.5 text-accent" />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-muted">Next action</span>
          </div>
          <span className="text-[9px] uppercase tracking-widest text-accent font-semibold">{action.kind === "topup" ? "Top up" : action.kind === "borrow" ? "Headroom" : "All clear"}</span>
        </div>

        {action.loan ? (
          <div>
            <div className="text-[10px] text-muted uppercase tracking-widest">
              {action.loan.collateralAsset} · {action.loan.accountName}
            </div>
            {action.kind === "topup" ? (
              <div className="tabular text-[26px] leading-none font-semibold text-primary mt-1">
                +{action.native?.toFixed(4)} <span className="text-[16px] text-muted">{action.loan.collateralAsset}</span>
              </div>
            ) : (
              <div className="tabular text-[26px] leading-none font-semibold text-accent mt-1">
                +${action.usd.toLocaleString()} <span className="text-[16px] text-muted">{action.loan.borrowAsset}</span>
              </div>
            )}
            <div className="text-[10px] text-muted tabular mt-1">
              {action.kind === "topup"
                ? `to bring LTV back to ${D.targetLtv}%`
                : `to reach ${D.targetLtv}% on this loan`}
            </div>
          </div>
        ) : (
          <div className="tabular text-[20px] font-semibold text-safe">Nothing to do</div>
        )}

        <div className="flex items-center justify-between border-t border-subtle pt-2">
          <span className="text-[9px] uppercase tracking-widest text-muted">Open · {action.loan?.borrowAsset}/{action.loan?.collateralAsset}</span>
          <span className="text-[9px] text-muted tabular">tap</span>
        </div>
      </div>
    </div>
  );
}
