import React from "react";
import { Lock } from "lucide-react";
import "./_group.css";
import { LOAN_DATA } from "./_phone";

export function WidgetLockInline() {
  const D = LOAN_DATA;
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgba(20,20,22,1)" }}>
      <div className="ledger-theme flex items-center gap-1.5 px-2">
        <Lock className="w-3 h-3 text-white/70" />
        <span className="text-[13px] text-white tabular tracking-tight">
          LTV {D.currentLtv}% <span className="text-white/60">·</span> target {D.targetLtv}% <span className="text-white/60">·</span> healthy
        </span>
      </div>
    </div>
  );
}
