import React from "react";
import { ChevronRight, Plus, Building2, User } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, useCurrency, fmtMoney } from "./_phone";
import {
  OWNER_ACCOUNTS, accountTotals, statusFor, serviceLtv, ExchangeMark, NavHeader, BottomNav,
} from "./_accounts";

export function Accounts() {
  const { c } = useCurrency();

  return (
    <Phone>
      <StatusBar />
      <NavHeader title="Accounts" subtitle="Settings" />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <p className="text-[12px] text-muted leading-snug mb-4">
          Group your exchanges by who owns them. Open an account to manage its services, targets and alerts.
        </p>

        <div className="space-y-3">
          {OWNER_ACCOUNTS.map(a => {
            const t = accountTotals(a);
            const status = statusFor(t.ltv, a.triggers);
            const statusColor =
              status === "Healthy" ? "var(--ledger-safe)" : status === "Warning" ? "var(--ledger-warning)" : "var(--ledger-danger)";
            return (
              <button key={a.id} className="w-full text-left rounded-2xl bg-surface border border-subtle p-4 active:opacity-80 transition-opacity">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--ledger-accent-muted)" }}>
                    {a.kind === "Trust" ? <Building2 className="w-5 h-5 text-accent" /> : <User className="w-5 h-5 text-accent" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-semibold text-primary truncate">{a.name}</span>
                      <span className="text-[9px] uppercase tracking-widest text-muted px-1.5 py-0.5 rounded bg-[#0F0F11] border border-subtle">{a.kind}</span>
                    </div>
                    <div className="text-[11px] text-muted">{a.services.length} {a.services.length === 1 ? "service" : "services"}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#3A3A3C] shrink-0" />
                </div>

                {/* Net equity + LTV */}
                <div className="flex items-end justify-between mt-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-muted">Net equity</div>
                    <div className="tabular text-[20px] font-semibold text-primary leading-tight mt-0.5">{fmtMoney(t.netEquity, c, 0)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-widest text-muted">Loan LTV</div>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                      <span className="tabular text-[20px] font-semibold leading-tight" style={{ color: statusColor }}>
                        {t.ltv > 0 ? `${t.ltv}%` : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Service chips */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {a.services.map(s => (
                    <div key={s.id} className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-[#0F0F11] border border-subtle">
                      <ExchangeMark exchange={s.exchange} size={20} />
                      <span className="text-[11px] font-medium text-primary">{s.exchange}</span>
                      <span className="text-[10px] tabular text-muted">{s.borrowedUsd > 0 ? `${serviceLtv(s)}%` : "assets"}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Add account */}
        <button className="w-full mt-3 rounded-2xl border border-dashed border-subtle bg-[#0F0F11]/40 px-4 py-4 flex items-center gap-3 active:opacity-80 transition-opacity">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#0F0F11] border border-dashed border-subtle">
            <Plus className="w-5 h-5 text-accent" />
          </div>
          <div className="text-left">
            <div className="text-[14px] font-medium text-accent">Add account</div>
            <div className="text-[11px] text-muted">Personal, Trust or Company</div>
          </div>
        </button>

        <div className="text-center text-[10px] text-muted mt-5 tracking-widest uppercase">
          Tap an account to manage it
        </div>
      </div>

      <BottomNav active="settings" />
      <HomeIndicator />
    </Phone>
  );
}
