import React from "react";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator } from "./_phone";

export function Onboarding() {
  const ltv = 65;
  return (
    <Phone>
      <StatusBar />
      <div className="flex items-center justify-between px-6 pt-2 pb-4 shrink-0">
        <button className="w-9 h-9 rounded-full bg-surface flex items-center justify-center border border-subtle">
          <ArrowLeft className="w-4 h-4 text-primary" />
        </button>
        <div className="tabular text-[12px] text-muted">Step 2 of 2</div>
        <div className="w-9 h-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-primary leading-tight">Set your target LTV</h1>
        <p className="text-muted text-[14px] mt-2 leading-snug">Ledger will warn you when your loan approaches this ratio and tell you how much more you can borrow below it.</p>

        <div className="mt-8 rounded-2xl bg-surface border border-subtle p-6 flex flex-col items-center">
          <div className="text-[11px] uppercase tracking-widest text-muted">Target LTV</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="tabular text-[64px] leading-none font-semibold text-primary">{ltv}</span>
            <span className="text-[24px] font-medium text-muted">%</span>
          </div>
          <div className="mt-6 w-full">
            <div className="relative h-1.5 bg-[#1F1F22] rounded-full">
              <div className="absolute top-0 left-0 h-full rounded-full bg-accent" style={{ width: `${(ltv / 78) * 100}%` }} />
              <div className="absolute top-[-6px] w-[14px] h-[14px] rounded-full bg-white border-2 border-accent" style={{ left: `calc(${(ltv / 78) * 100}% - 7px)` }} />
            </div>
            <div className="flex justify-between mt-3 text-[10px] text-muted tabular">
              <span>0%</span><span>Liquidation 78%</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
            <ShieldCheck className="w-4 h-4 text-accent" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-primary">Below liquidation</div>
            <div className="text-[12px] text-muted leading-snug">You'll have a 13% buffer before Binance forces collateral sales.</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4 flex items-start gap-3 opacity-60">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#1F1F22]">
            <KeyRound className="w-4 h-4 text-muted" />
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-medium text-primary flex items-center gap-2">
              Binance API
              <span className="text-[10px] uppercase tracking-wide text-safe">Connected</span>
            </div>
            <div className="text-[12px] text-muted tabular leading-snug">A1B2···f9 · read-only</div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-10 pt-3 border-t border-subtle">
        <button className="w-full h-12 bg-white text-black rounded-xl font-medium text-[15px]">Continue</button>
      </div>
      <HomeIndicator />
    </Phone>
  );
}
