import React from "react";
import { ChevronRight, KeyRound, Plus } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, TabBar, ACCOUNTS, useCurrency, USD_ZAR_RATE } from "./_phone";

export function Settings() {
  const { c, set } = useCurrency();
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

        <Section title="Display currency">
          <div className="px-4 py-3">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0F0F11]">
              {(["USD", "ZAR"] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => set(opt)}
                  className="py-2 text-[12px] font-semibold rounded-md transition-colors"
                  style={{
                    backgroundColor: c === opt ? "var(--ledger-surface-elevated)" : "transparent",
                    color: c === opt ? "var(--ledger-text)" : "var(--ledger-muted)",
                  }}
                >
                  {opt === "USD" ? "US Dollar ($)" : "South African Rand (R)"}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-muted tabular mt-2">Rate: 1 USD = R {USD_ZAR_RATE.toFixed(2)} · auto-updated daily</div>
          </div>
        </Section>

        <Section
          title="Binance accounts"
          trailing={<span className="text-[10px] text-muted tabular">{ACCOUNTS.length} connected</span>}
        >
          {ACCOUNTS.map((a, i) => (
            <div key={a.id} className={`px-4 py-3 flex items-center gap-3 ${i < ACCOUNTS.length - 1 ? "border-b border-subtle" : "border-b border-subtle"}`}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
                <KeyRound className="w-4 h-4 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-primary truncate">{a.name}</span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-safe" />
                    <span className="text-[10px] uppercase tracking-wide text-safe font-medium">Live</span>
                  </span>
                </div>
                <div className="text-[11px] text-muted tabular truncate">{a.apiKeyMasked} · read-only · {a.loans.length} loan{a.loans.length === 1 ? "" : "s"}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-[#3A3A3C] shrink-0" />
            </div>
          ))}
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[#0F0F11] border border-dashed border-subtle">
              <Plus className="w-4 h-4 text-muted" />
            </div>
            <span className="text-[13px] font-medium text-accent">Add another Binance account</span>
          </div>
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

function Section({ title, children, trailing }: { title: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[10px] uppercase tracking-widest text-muted">{title}</div>
        {trailing}
      </div>
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
