import React from "react";
import { ArrowLeft, MoreHorizontal, TrendingUp, TrendingDown, Timer, ExternalLink, AlertTriangle } from "lucide-react";
import "./_group.css";
import {
  Phone, StatusBar, HomeIndicator, LtvGauge, StatusPill,
  ACCOUNTS, headroom, topUpCollateral, useCurrency, fmtMoney, CurrencyToggle,
  TARGET_LTV, WARNING_LTV, LIQUIDATION_LTV, priceAtLtv, priceDropPctTo, LIVE_PRICES, ltvHistory,
} from "./_phone";

export function LoanDetail() {
  const loan = ACCOUNTS[0].loans[0];
  const { c } = useCurrency();

  const headroomUsdt = headroom(loan);
  const topUp = topUpCollateral(loan);
  const status: "Healthy" | "Warning" | "Danger" =
    loan.ltv < TARGET_LTV ? "Healthy" : loan.ltv < LIQUIDATION_LTV * 0.92 ? "Warning" : "Danger";

  const warnPrice = priceAtLtv(loan, WARNING_LTV);
  const liqPrice = priceAtLtv(loan, LIQUIDATION_LTV);
  const warnDrop = priceDropPctTo(loan, WARNING_LTV);
  const liqDrop = priceDropPctTo(loan, LIQUIDATION_LTV);
  const currentPrice = LIVE_PRICES[loan.collateralAsset];

  const spark = ltvHistory(loan, 7);
  const projection30d = (loan.borrowed * (loan.apr / 100) * 30) / 365;

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
        <div className="flex justify-end mb-2"><CurrencyToggle /></div>

        {/* 7-day LTV sparkline */}
        <div className="rounded-2xl bg-surface border border-subtle p-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest text-muted">LTV · 7d</span>
            <span className="tabular text-[10px] text-muted">{Math.min(...spark).toFixed(1)}% → {loan.ltv}%</span>
          </div>
          <Sparkline data={spark} target={TARGET_LTV} />
        </div>

        {/* Gauge */}
        <div className="rounded-2xl bg-surface border border-subtle p-5 flex flex-col items-center">
          <div className="w-full flex justify-end"><StatusPill status={status} /></div>
          <LtvGauge value={loan.ltv} target={TARGET_LTV} liquidation={LIQUIDATION_LTV} size={240} strokeWidth={16} />
          <div className="-mt-12 flex items-baseline gap-1">
            <span className="tabular text-[52px] leading-none font-semibold text-primary">{loan.ltv}</span>
            <span className="text-[20px] font-medium text-muted">%</span>
          </div>
          <div className="text-[12px] text-muted mt-1">Loan-to-Value</div>
        </div>

        {/* Price-trigger card */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
              <span className="text-[11px] uppercase tracking-widest text-muted">Price triggers · {loan.collateralAsset}</span>
            </div>
            <span className="tabular text-[10px] text-muted">now {fmtMoney(currentPrice, c, 0)}</span>
          </div>
          <div className="space-y-2.5">
            <TriggerRow
              label="Warning"
              price={fmtMoney(warnPrice, c, 0)}
              drop={warnDrop}
              color="var(--ledger-warning)"
            />
            <TriggerRow
              label="Liquidation"
              price={fmtMoney(liqPrice, c, 0)}
              drop={liqDrop}
              color="var(--ledger-danger)"
            />
          </div>
        </div>

        {/* Room to borrow + Top up */}
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

        {/* Interest projection */}
        <div className="mt-4 rounded-2xl bg-surface border border-subtle p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-widest text-muted">Interest projection</span>
            <span className="tabular text-[10px] text-muted">{loan.apr.toFixed(2)}% APR</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ProjRow label="7d" value={fmtMoney((loan.borrowed * (loan.apr / 100) * 7) / 365, c)} />
            <ProjRow label="30d" value={fmtMoney(projection30d, c)} highlight />
            <ProjRow label="365d" value={fmtMoney(loan.borrowed * (loan.apr / 100), c)} />
          </div>
        </div>

        {/* Position */}
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 px-1">Position</div>
          <div className="rounded-2xl bg-surface border border-subtle">
            <Row label="Account" value={loan.accountName} />
            <Row label="Principal" value={`${loan.borrowed.toLocaleString()} ${loan.borrowAsset}`} />
            <Row label="Collateral" value={`${loan.collateral} ${loan.collateralAsset} · ${fmtMoney(loan.collateralUsd, c, 0)}`} last />
          </div>
        </div>

        {/* Schedule */}
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 px-1">Schedule</div>
          <div className="rounded-2xl bg-surface border border-subtle">
            <Row label="Interest rate" value={`${loan.apr.toFixed(2)}% APR · ${(loan.apr / 365 / 24).toFixed(4)}%/hr`} />
            <Row label="Interest accrued · 30d" value={fmtMoney(loan.interest30d, c)} />
            <Row label="Next tick" value="58m 12s" icon={<Timer className="w-3.5 h-3.5 text-muted" />} />
            <Row label="Opened" value="Apr 14, 2026" last />
          </div>
        </div>

        {/* Open in Binance — read-only app, real actions happen there */}
        <button className="mt-5 w-full h-12 rounded-xl border border-subtle bg-surface flex items-center justify-center gap-2 text-[13px] font-medium text-primary">
          <ExternalLink className="w-4 h-4" /> Open in Binance to adjust
        </button>
      </div>
      <HomeIndicator />
    </Phone>
  );
}

function Sparkline({ data, target }: { data: number[]; target: number }) {
  const all = [...data, target];
  const min = Math.min(...all) - 1, max = Math.max(...all) + 1;
  const w = 320, h = 44;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return `${x},${y}`;
  });
  const targetY = h - ((target - min) / (max - min)) * h;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="lh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00F0FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={targetY} y2={targetY} stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3 3" />
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill="url(#lh)" />
      <polyline points={pts.join(" ")} fill="none" stroke="#00F0FF" strokeWidth="1.8" />
    </svg>
  );
}

function TriggerRow({ label, price, drop, color }: { label: string; price: string; drop: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[12px]" style={{ color }}>{label}</span>
      </div>
      <div className="text-right">
        <div className="tabular text-[14px] font-semibold text-primary leading-tight">{price}</div>
        <div className="tabular text-[10px]" style={{ color }}>{drop.toFixed(1)}% from now</div>
      </div>
    </div>
  );
}

function ProjRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: highlight ? "var(--ledger-surface-elevated)" : "transparent", border: highlight ? "1px solid var(--ledger-border)" : "none" }}>
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular text-[14px] font-semibold mt-0.5 ${highlight ? "text-accent" : "text-primary"}`}>{value}</div>
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
