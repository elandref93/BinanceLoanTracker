import React from "react";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator } from "./_phone";

export function Onboarding() {
  return (
    <Phone>
      <StatusBar />
      <div className="flex items-center justify-between px-6 pt-2 pb-4 shrink-0">
        <button className="w-9 h-9 rounded-full bg-surface flex items-center justify-center border border-subtle">
          <ArrowLeft className="w-4 h-4 text-primary" />
        </button>
        <div className="tabular text-[12px] text-muted">Step 1 of 2 · Add account</div>
        <div className="w-9 h-9" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-primary leading-tight">Connect a Binance account</h1>
        <p className="text-muted text-[14px] mt-2 leading-snug">Add as many accounts as you like. Each one lives separately so you can track its loans, interest, and headroom on its own.</p>

        {/* Account name */}
        <div className="mt-6">
          <label className="text-[10px] uppercase tracking-widest text-muted">Account name</label>
          <div className="mt-2 rounded-xl bg-surface border border-subtle px-4 py-3">
            <div className="text-[15px] text-primary">Main · Spot</div>
          </div>
          <div className="text-[11px] text-muted mt-1.5">Shown across the app and on widgets — e.g. "Main", "Hedge", "Long-term".</div>
        </div>

        {/* API Key */}
        <div className="mt-5">
          <label className="text-[10px] uppercase tracking-widest text-muted">API key</label>
          <div className="mt-2 rounded-xl bg-surface border border-subtle px-4 py-3 tabular text-[14px] text-primary tracking-wider">A1B2···································f9</div>
        </div>

        {/* API Secret */}
        <div className="mt-4">
          <label className="text-[10px] uppercase tracking-widest text-muted">API secret</label>
          <div className="mt-2 rounded-xl bg-surface border border-subtle px-4 py-3 tabular text-[14px] text-muted tracking-wider">••••••••••••••••••••••••••••••••••••</div>
        </div>

        {/* Permission reminder */}
        <div className="mt-5 rounded-2xl bg-surface border border-subtle p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
            <ShieldCheck className="w-4 h-4 text-accent" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-primary">Read-only permissions</div>
            <div className="text-[12px] text-muted leading-snug">Ledger never has authority to trade, borrow, withdraw, or repay on your behalf.</div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4 flex items-start gap-3 opacity-60">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#1F1F22]">
            <KeyRound className="w-4 h-4 text-muted" />
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-medium text-primary">Next: set your target LTV</div>
            <div className="text-[12px] text-muted leading-snug">Applies to every account.</div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-10 pt-3 border-t border-subtle">
        <button className="w-full h-12 bg-white text-black rounded-xl font-medium text-[15px]">Connect & continue</button>
      </div>
      <HomeIndicator />
    </Phone>
  );
}
