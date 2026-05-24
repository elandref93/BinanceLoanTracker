import React from "react";
import { ArrowLeft, MoreHorizontal, TrendingUp, TrendingDown, Timer } from "lucide-react";
import "./_group.css";
import {
  Phone, StatusBar, HomeIndicator, LtvGauge, StatusPill,
  ACCOUNTS, headroom, topUpCollateral, useCurrency, fmtMoney, CurrencyToggle,
  TARGET_LTV, LIQUIDATION_LTV,
} from "./_phone";

export function LoanDetail() {
  // Show first loan (USDT / BTC on Main · Spot) for the mockup
  const loan = ACCOUNTS[0].loans[0];
  const { c } = useCurrency();

  const headroomUsdt = headroom(loan);
  const topUp = topUpCollateral(loan);
  const status: "Healthy" | "Warning" | "Danger" =
    loan.ltv < TARGET_LTV ? "Healthy" : loan.ltv < LIQUIDATION_LTV * 0.92 ? "Warning" : "Danger";

  return (
    <Phone>
      <StatusBar />
      <div className="flex items-start justify-between px-5 pt-2 pb-3 shrink-0 gap-3">
        <button className="w-9 h-9 rounded-full bg-surface flex items-center justify-center border border-subtle shrink-0">
          <ArrowLeft className="w-4 h-4 text-primary" />
        </button>
        <div className="flex-1 text-center min-w-0">
          <div className="text-[15px] font-medium text-primary leading-tight">USDT / BTC Loan</div>
          <div className="text-[10px] text-muted truncate">{loan.accountName}</div>
        </div>
        <button className="w-9 h-9 rounded-full bg-surface flex items-center justify-center border border-subtle shrink-0">
          <MoreHorizontal className="w-4 h-4 text-primary" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex justify-end mb-2">
          <CurrencyToggle />
        </div>

        {/* Gauge */}
        <div className="rounded-2xl bg-surface border border-subtle p-5 flex flex-col items-center">
          <div className="w-full flex justify-end"><StatusPill status={status} /></div>
          <LtvGauge value={loan.ltv} target={TARGET_LTV} liquidation={LIQUIDATION_LTV} size={260} strokeWidth={16} />
          <div className="-mt-14 flex items-baseline gap-1">
            <span className="tabular text-[56px] leading-none font-semibold text-primary">{loan.ltv}</span>
            <span className="text-[20px] font-medium text-muted">%</span>
          </div>
          <div className="text-[12px] text-muted mt-1">Loan-to-Value</div>
          <div className="grid grid-cols-3 gap-2 w-full mt-5">
            <Zone label="Safe" range="≤ 65%" color="var(--ledger-safe)" active={loan.ltv <= 65} />
            <Zone label="Warning" range="65–72%" color="var(--ledger-warning)" active={loan.ltv > 65 && loan.ltv <= 72} />
            <Zone label="Danger" range="≥ 72%" color="var(--ledger-danger)" active={loan.ltv > 72} />
          </div>
        </div>

        {/* Action cards — calculations are loan-specific */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-2xl bg-surface border border-subtle p-4">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent" />
              <span className="text-[10px] uppercase tracking-widest text-muted">Room to borrow</span>
            </div>
            <div className="tabular text-[22px] font-semibold mt-2 text-accent leading-tight">+{fmtMoney(headroomUsdt, c, 0)}</div>
            <div className="text-[11px] text-muted">on this loan, to reach {TARGET_LTV}%</div>
          </div>
          <div className="rounded-2xl bg-surface border border-subtle p-4">
            <div className="flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5 text-safe" />
              <span className="text-[10px] uppercase tracking-widest text-muted">Top-up</span>
            </div>
            <div className="tabular text-[22px] font-semibold mt-2 text-safe leading-tight">
              {topUp.native > 0 ? `+${topUp.native.toFixed(4)} ${loan.collateralAsset}` : "None"}
            </div>
            <div className="text-[11px] text-muted">{topUp.native > 0 ? `≈ ${fmtMoney(topUp.usd, c, 0)} collateral needed` : "Below target"}</div>
          </div>
        </div>

        {/* Loan terms */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle">
          <Row label="Account" value={loan.accountName} />
          <Row label="Principal" value={`${loan.borrowed.toLocaleString()} ${loan.borrowAsset}`} />
          <Row label="Interest rate" value={`${loan.apr.toFixed(2)}% APR · ${(loan.apr / 365 / 24).toFixed(4)}%/hr`} />
          <Row label="Interest accrued" value={fmtMoney(loan.interest30d, c)} />
          <Row label="Next tick" value="58m 12s" icon={<Timer className="w-3.5 h-3.5 text-muted" />} />
          <Row label="Collateral" value={`${loan.collateral} ${loan.collateralAsset} · ${fmtMoney(loan.collateralUsd, c, 0)}`} />
          <Row label="Borrowed" value={`${loan.borrowed.toLocaleString()} ${loan.borrowAsset}`} />
          <Row label="Opened" value="Apr 14, 2026" last />
        </div>
      </div>
      <HomeIndicator />
    </Phone>
  );
}

function Zone({ label, range, color, active }: { label: string; range: string; color: string; active: boolean }) {
  return (
    <div className="rounded-lg p-2 border" style={{ borderColor: active ? color : "var(--ledger-border)", backgroundColor: active ? `${color}11` : "transparent" }}>
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-medium" style={{ color: active ? color : "var(--ledger-muted)" }}>{label}</span>
      </div>
      <div className="text-[10px] text-muted tabular mt-0.5">{range}</div>
    </div>
  );
}

function Row({ label, value, last, icon }: { label: string; value: string; last?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${last ? "" : "border-b border-subtle"}`}>
      <span className="text-[13px] text-muted">{label}</span>
      <div className="flex items-center gap-1.5 text-right">
        {icon}
        <span className="tabular text-[13px] text-primary">{value}</span>
      </div>
    </div>
  );
}
