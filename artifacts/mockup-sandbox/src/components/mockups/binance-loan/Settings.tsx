import React from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar } from "./_phone";

export function Settings() {
  return (
    <Phone>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-primary">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <Section title="Loan management">
          <Row label="Target LTV" value="65%" chev />
          <Row label="Warning threshold" value="70%" chev />
          <Row label="Danger threshold" value="75%" chev last />
        </Section>

        <Section title="Binance connection">
          <div className="px-4 py-3 flex items-center gap-3 border-b border-subtle">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
              <KeyRound className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-primary">API Key</span>
                <span className="inline-flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-safe" />
                  <span className="text-[10px] uppercase tracking-wide text-safe font-medium">Connected</span>
                </span>
              </div>
              <div className="text-[11px] text-muted tabular">A1B2···f9 · read-only</div>
            </div>
          </div>
          <Row label="Reconnect" value="" chev />
          <Row label="Remove API key" value="" valueClass="text-danger" last />
        </Section>

        <Section title="Notifications">
          <Toggle label="Warning alerts" sub="Push when LTV crosses warning threshold" on />
          <Toggle label="Danger alerts" sub="Push when LTV crosses danger threshold" on />
          <Toggle label="Daily summary" sub="9:00 AM digest of loan + interest" last />
        </Section>

        <Section title="Account">
          <Row label="Google account" value="alex@ledger.app" />
          <Row label="Sign out" value="" valueClass="text-danger" last />
        </Section>

        <div className="text-center mt-6 mb-2">
          <div className="text-[10px] text-muted tabular tracking-widest uppercase">Ledger · v1.0.4 · Private build</div>
        </div>
      </div>
      <TabBar active="settings" />
      <HomeIndicator />
    </Phone>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] uppercase tracking-widest text-muted mb-2 px-1">{title}</div>
      <div className="rounded-2xl bg-surface border border-subtle overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ label, value, chev, last, valueClass = "text-muted" }: { label: string; value: string; chev?: boolean; last?: boolean; valueClass?: string }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-subtle"}`}>
      <span className="text-[13px] text-primary">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`tabular text-[13px] ${valueClass}`}>{value}</span>
        {chev && <ChevronRight className="w-3.5 h-3.5 text-[#3A3A3C]" />}
      </div>
    </div>
  );
}

function Toggle({ label, sub, on, last }: { label: string; sub?: string; on?: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-subtle"}`}>
      <div className="min-w-0 pr-4">
        <div className="text-[13px] text-primary">{label}</div>
        {sub && <div className="text-[11px] text-muted leading-tight">{sub}</div>}
      </div>
      <div className="w-[44px] h-[26px] rounded-full p-[2px] transition-colors" style={{ backgroundColor: on ? "var(--ledger-safe)" : "#1F1F22" }}>
        <div className="w-[22px] h-[22px] rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(18px)" : "translateX(0)" }} />
      </div>
    </div>
  );
}
