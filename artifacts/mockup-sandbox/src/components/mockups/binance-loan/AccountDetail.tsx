import React from "react";
import { ChevronRight, Plus, Trash2, MoreHorizontal } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, useCurrency, fmtMoney, LtvBar } from "./_phone";
import {
  getAccount, accountTotals, statusFor, serviceLtv, ExchangeMark, NavHeader, BottomNav, Section, Toggle, LIQUIDATION,
} from "./_accounts";

export function AccountDetail() {
  const account = getAccount("personal");
  const { c } = useCurrency();
  const t = accountTotals(account);
  const status = statusFor(t.ltv, account.triggers);
  const statusColor =
    status === "Healthy" ? "var(--ledger-safe)" : status === "Warning" ? "var(--ledger-warning)" : "var(--ledger-danger)";

  const tr = account.triggers;

  return (
    <Phone>
      <StatusBar />
      <NavHeader
        title={account.name}
        subtitle={`${account.kind} · ${account.services.length} services`}
        trailing={
          <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "var(--ledger-muted)" }}>
            <MoreHorizontal className="w-5 h-5" />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {/* Summary card */}
        <div className="rounded-2xl bg-surface border border-subtle p-4 mb-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">Net equity</div>
              <div className="tabular text-[26px] font-semibold text-primary leading-tight mt-0.5">{fmtMoney(t.netEquity, c, 0)}</div>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ backgroundColor: `${statusColor}22` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: statusColor }}>{status}</span>
            </div>
          </div>
          <div className="mt-3">
            <LtvBar value={t.ltv} target={tr.target} liquidation={LIQUIDATION} height={6} />
            <div className="flex justify-between mt-1.5 text-[10px] text-muted tabular">
              <span>LTV {t.ltv}%</span>
              <span>Target {tr.target}% · Liq {LIQUIDATION}%</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat label="Collateral" value={fmtMoney(t.collateral, c, 0)} />
            <Stat label="Borrowed" value={fmtMoney(t.borrowed, c, 0)} />
            <Stat label="Headroom" value={`+${fmtMoney(t.headroom, c, 0)}`} accent />
          </div>
        </div>

        {/* Linked services */}
        <Section title="Linked services" trailing={<span className="text-[10px] text-muted tabular">{account.services.length} connected</span>}>
          {account.services.map((s, i) => (
            <div key={s.id} className={`px-4 py-3 ${i < account.services.length - 1 ? "border-b border-subtle" : ""}`}>
              <div className="flex items-center gap-3">
                <ExchangeMark exchange={s.exchange} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-primary truncate">{s.exchange}</span>
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.status === "live" ? "var(--ledger-safe)" : "var(--ledger-danger)" }} />
                      <span className="text-[9px] uppercase tracking-wide font-medium" style={{ color: s.status === "live" ? "var(--ledger-safe)" : "var(--ledger-danger)" }}>{s.status === "live" ? "Live" : "Error"}</span>
                    </span>
                  </div>
                  <div className="text-[11px] text-muted tabular truncate">{s.apiKeyMasked} · {s.label} · {s.syncedAgo}</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-[#3A3A3C] shrink-0" />
              </div>
              <div className="ml-12 mt-2 flex items-center gap-4 text-[11px] tabular">
                {s.borrowedUsd > 0 ? (
                  <>
                    <span className="text-muted">Borrowed <span className="text-primary">{fmtMoney(s.borrowedUsd, c, 0)}</span></span>
                    <span className="text-muted">LTV <span style={{ color: statusColor }}>{serviceLtv(s)}%</span></span>
                  </>
                ) : (
                  <span className="text-muted">Assets <span className="text-primary">{fmtMoney(s.assetsUsd, c, 0)}</span> · no loans</span>
                )}
              </div>
            </div>
          ))}
          <button className="w-full px-4 py-3 flex items-center gap-3 active:opacity-70">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[#0F0F11] border border-dashed border-subtle">
              <Plus className="w-4 h-4 text-accent" />
            </div>
            <span className="text-[13px] font-medium text-accent">Add service · Binance, Luno…</span>
          </button>
        </Section>

        {/* Per-account targets */}
        <Section title="Targets for this account">
          <div className="px-4 py-4">
            <ThresholdTrack target={tr.target} warning={tr.warning} danger={tr.danger} />
            <div className="grid grid-cols-3 gap-2 mt-4">
              <ThresholdLabel name="Target" value={tr.target} color="var(--ledger-safe)" />
              <ThresholdLabel name="Warning" value={tr.warning} color="var(--ledger-warning)" />
              <ThresholdLabel name="Danger" value={tr.danger} color="var(--ledger-danger)" />
            </div>
            <div className="text-[10px] text-muted mt-3 tabular leading-tight">Applies only to {account.name}. Liquidation is fixed by the exchange at {LIQUIDATION}%.</div>
          </div>
        </Section>

        {/* Per-account notifications */}
        <Section title="Alerts for this account">
          <ToggleRow label="Warning alerts" sub={`Push when LTV crosses ${tr.warning}%`} on={account.alerts.warning} />
          <ToggleRow label="Danger alerts" sub={`Push when LTV crosses ${tr.danger}%`} on={account.alerts.danger} />
          <ToggleRow label="Daily summary" sub="9:00 AM digest of loans + interest" on={account.alerts.daily} last />
        </Section>

        {/* Danger zone */}
        <Section title="Danger zone">
          <button className="w-full px-4 py-3.5 flex items-center gap-3 active:opacity-70">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(255,69,58,0.12)" }}>
              <Trash2 className="w-4 h-4 text-danger" />
            </div>
            <div className="text-left">
              <div className="text-[13px] font-medium text-danger">Delete account</div>
              <div className="text-[11px] text-muted">Removes {account.name} and unlinks its {account.services.length} services</div>
            </div>
          </button>
        </Section>
      </div>

      <BottomNav active="settings" />
      <HomeIndicator />
    </Phone>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-[#0F0F11] border border-subtle px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular text-[14px] font-semibold mt-1 ${accent ? "text-accent" : "text-primary"}`}>{value}</div>
    </div>
  );
}

function ThresholdLabel({ name, value, color }: { name: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-[#0F0F11] border border-subtle p-2.5">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] uppercase tracking-widest text-muted">{name}</span>
      </div>
      <div className="tabular text-[16px] font-semibold mt-0.5" style={{ color }}>{value}%</div>
    </div>
  );
}

function ThresholdTrack({ target, warning, danger }: { target: number; warning: number; danger: number }) {
  const MAX = LIQUIDATION;
  const pos = (v: number) => `${(v / MAX) * 100}%`;
  const handle = (v: number, color: string) => (
    <div className="absolute rounded-full border-2 border-white shadow" style={{ width: 16, height: 16, top: "50%", left: pos(v), transform: "translate(-50%, -50%)", backgroundColor: color }} />
  );
  return (
    <div className="select-none">
      <div className="relative h-2 rounded-full bg-[#1F1F22]">
        <div className="absolute top-0 bottom-0 left-0 rounded-l-full bg-safe/50" style={{ width: pos(target) }} />
        <div className="absolute top-0 bottom-0 bg-warning/40" style={{ left: pos(target), width: `calc(${pos(warning)} - ${pos(target)})` }} />
        <div className="absolute top-0 bottom-0 bg-danger/40" style={{ left: pos(warning), width: `calc(${pos(danger)} - ${pos(warning)})` }} />
        <div className="absolute top-0 bottom-0 bg-danger/70 rounded-r-full" style={{ left: pos(danger), right: 0 }} />
        {handle(target, "var(--ledger-safe)")}
        {handle(warning, "var(--ledger-warning)")}
        {handle(danger, "var(--ledger-danger)")}
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[9px] text-muted tabular">0%</span>
        <span className="text-[9px] text-danger tabular">Liq {LIQUIDATION}%</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, sub, on, last }: { label: string; sub?: string; on: boolean; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3.5 ${last ? "" : "border-b border-subtle"}`}>
      <div className="min-w-0 pr-4">
        <div className="text-[13px] text-primary">{label}</div>
        {sub && <div className="text-[11px] text-muted leading-tight">{sub}</div>}
      </div>
      <Toggle on={on} />
    </div>
  );
}
