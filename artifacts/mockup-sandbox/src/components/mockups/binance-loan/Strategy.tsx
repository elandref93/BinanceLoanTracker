import React from "react";
import { ArrowDownToLine, TrendingUp, ShieldCheck, AlertTriangle, ChevronRight } from "lucide-react";
import "./_group.css";
import { Phone, StatusBar, HomeIndicator, useCurrency, fmtMoney, LtvGauge } from "./_phone";
import {
  OWNER_ACCOUNTS, accountTotals, statusFor, serviceLtv, ExchangeMark, BottomNav, LIQUIDATION,
} from "./_accounts";

export function Strategy() {
  const { c } = useCurrency();
  const [sel, setSel] = React.useState(OWNER_ACCOUNTS[0].id);
  const account = OWNER_ACCOUNTS.find(a => a.id === sel) ?? OWNER_ACCOUNTS[0];
  const t = accountTotals(account);
  const tr = account.triggers;
  const status = statusFor(t.ltv, tr);
  const statusColor =
    status === "Healthy" ? "var(--ledger-safe)" : status === "Warning" ? "var(--ledger-warning)" : "var(--ledger-danger)";

  // Next move: top-up if over target, otherwise borrow into headroom.
  const overTarget = t.ltv > tr.target && t.collateral > 0;
  const topUpUsd = overTarget ? Math.round(t.borrowed / (tr.target / 100) - t.collateral) : 0;

  // How far the collateral price can fall before liquidation (positive remaining-drop %).
  const dropToLiq = t.collateral > 0 ? Math.round((1 - t.borrowed / (LIQUIDATION / 100) / t.collateral) * 100) : 0;

  return (
    <Phone>
      <StatusBar />
      <div className="px-5 pt-2 pb-2 shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-primary">Strategy</h1>
        <p className="text-[11px] text-muted">Per-account playbook to keep loans healthy</p>
      </div>

      {/* Account switcher */}
      <div className="px-5 shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {OWNER_ACCOUNTS.map(a => {
            const at = accountTotals(a);
            const active = a.id === sel;
            return (
              <button
                key={a.id}
                onClick={() => setSel(a.id)}
                className="shrink-0 px-3 py-1.5 rounded-full border text-left transition-colors"
                style={{
                  backgroundColor: active ? "var(--ledger-accent-muted)" : "var(--ledger-surface)",
                  borderColor: active ? "var(--ledger-accent)" : "var(--ledger-border)",
                }}
              >
                <div className="text-[12px] font-medium leading-tight" style={{ color: active ? "var(--ledger-accent)" : "var(--ledger-text)" }}>{a.name}</div>
                <div className="text-[9px] text-muted tabular tracking-wide leading-none mt-0.5">{at.ltv > 0 ? `LTV ${at.ltv}%` : "assets only"}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
        {/* Hero: blended LTV vs target */}
        <div className="rounded-2xl bg-surface border border-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted">{account.name} · loan health</span>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ backgroundColor: `${statusColor}22` }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: statusColor }}>{status}</span>
            </div>
          </div>
          <div className="flex flex-col items-center mt-1">
            <LtvGauge value={t.ltv} target={tr.target} liquidation={LIQUIDATION} size={210} strokeWidth={15} />
            <div className="-mt-11 flex items-baseline gap-1">
              <span className="tabular text-[48px] leading-none font-semibold text-primary">{t.ltv}</span>
              <span className="text-[18px] font-medium text-muted">%</span>
            </div>
            <div className="text-[11px] text-muted mt-1 tabular">Target {tr.target}% · Warning {tr.warning}% · Liq {LIQUIDATION}%</div>
          </div>
        </div>

        {/* Next move */}
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: overTarget ? "var(--ledger-warning)" : "var(--ledger-accent)", backgroundColor: overTarget ? "rgba(255,159,10,0.08)" : "var(--ledger-accent-muted)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            {overTarget ? <ArrowDownToLine className="w-3.5 h-3.5 text-warning" /> : <TrendingUp className="w-3.5 h-3.5 text-accent" />}
            <span className="text-[10px] uppercase tracking-widest" style={{ color: overTarget ? "var(--ledger-warning)" : "var(--ledger-accent)" }}>Next move</span>
          </div>
          {overTarget ? (
            <>
              <div className="text-[15px] font-semibold text-primary leading-snug">Add {fmtMoney(topUpUsd, c, 0)} collateral</div>
              <div className="text-[12px] text-muted mt-0.5">Brings {account.name} back to its {tr.target}% target and out of the warning band.</div>
            </>
          ) : t.collateral > 0 ? (
            <>
              <div className="text-[15px] font-semibold text-primary leading-snug">Room to borrow {fmtMoney(t.headroom, c, 0)}</div>
              <div className="text-[12px] text-muted mt-0.5">{account.name} sits below its {tr.target}% target — borrowing capacity is available if needed.</div>
            </>
          ) : (
            <>
              <div className="text-[15px] font-semibold text-primary leading-snug">No active loans</div>
              <div className="text-[12px] text-muted mt-0.5">{account.name} holds {fmtMoney(t.assets, c, 0)} in spot assets across {account.services.length} services.</div>
            </>
          )}
        </div>

        {/* Guardrails */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <ShieldCheck className="w-3.5 h-3.5 text-safe" />
            <span className="text-[10px] uppercase tracking-widest text-muted">Guardrails</span>
          </div>
          <div className="space-y-2.5">
            <Rule color="var(--ledger-warning)" text={`If LTV crosses ${tr.warning}%, push a warning alert`} on={account.alerts.warning} />
            <Rule color="var(--ledger-danger)" text={`If LTV crosses ${tr.danger}%, push a danger alert + top-up nudge`} on={account.alerts.danger} />
            <Rule color="var(--ledger-accent)" text={`Hold blended LTV at or below the ${tr.target}% target`} on />
          </div>
        </div>

        {/* Risk + headroom strip */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface border border-subtle p-4">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-danger" />
              <span className="text-[9px] uppercase tracking-widest text-muted">To liquidation</span>
            </div>
            <div className="tabular text-[22px] font-semibold mt-1.5" style={{ color: dropToLiq < 20 ? "var(--ledger-danger)" : "var(--ledger-text)" }}>
              {t.collateral > 0 ? `−${dropToLiq}%` : "—"}
            </div>
            <div className="text-[10px] text-muted">collateral price drop</div>
          </div>
          <div className="rounded-2xl bg-surface border border-subtle p-4">
            <div className="text-[9px] uppercase tracking-widest text-muted">Borrow headroom</div>
            <div className="tabular text-[22px] font-semibold text-accent mt-1.5">+{fmtMoney(t.headroom, c, 0)}</div>
            <div className="text-[10px] text-muted">to {tr.target}% target</div>
          </div>
        </div>

        {/* Service breakdown */}
        <div className="mt-4 mb-1">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 px-1">Where it sits</div>
          <div className="rounded-2xl bg-surface border border-subtle divide-y" style={{ borderColor: "var(--ledger-border)" }}>
            {account.services.map(s => (
              <div key={s.id} className="p-4 flex items-center gap-3">
                <ExchangeMark exchange={s.exchange} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-primary">{s.exchange}</div>
                  <div className="text-[10px] text-muted">{s.borrowedUsd > 0 ? `${fmtMoney(s.borrowedUsd, c, 0)} borrowed` : "Spot assets only"}</div>
                </div>
                <div className="text-right">
                  <div className="tabular text-[13px] font-semibold" style={{ color: s.borrowedUsd > 0 ? statusColor : "var(--ledger-text)" }}>
                    {s.borrowedUsd > 0 ? `${serviceLtv(s)}%` : fmtMoney(s.assetsUsd, c, 0)}
                  </div>
                  <div className="text-[9px] text-muted">{s.borrowedUsd > 0 ? "LTV" : "assets"}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#3A3A3C] shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomNav active="strategy" />
      <HomeIndicator />
    </Phone>
  );
}

function Rule({ color, text, on }: { color: string; text: string; on: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: on ? color : "#3A3A3C" }} />
      <span className={`text-[12px] leading-snug ${on ? "text-primary" : "text-muted line-through"}`}>{text}</span>
    </div>
  );
}
