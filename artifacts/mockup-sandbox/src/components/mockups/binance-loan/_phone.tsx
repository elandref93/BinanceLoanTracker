import React from "react";

export function StatusBar() {
  return (
    <div className="flex justify-between items-center px-6 pt-4 pb-2 text-[13px] font-medium text-white z-10 shrink-0">
      <div className="tabular">9:41</div>
      <div className="flex gap-1.5 items-center">
        <div className="w-4 h-3 bg-white rounded-[2px]" />
        <div className="w-3 h-3 bg-white rounded-full" />
        <div className="w-5 h-2.5 border border-white rounded-sm relative">
          <div className="absolute top-[1px] left-[1px] bottom-[1px] w-[70%] bg-white rounded-[1px]" />
          <div className="absolute right-[-3px] top-1/2 -translate-y-1/2 w-[2px] h-1 bg-white rounded-r-sm" />
        </div>
      </div>
    </div>
  );
}

export function HomeIndicator() {
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-1/3 h-[5px] bg-white rounded-full opacity-20 z-10" />
  );
}

export function Phone({ children }: { children: React.ReactNode }) {
  return (
    <CurrencyProvider>
      <div className="min-h-screen flex items-center justify-center bg-black p-4">
        <div className="ledger-theme w-[390px] h-[844px] relative bg-app overflow-hidden flex flex-col border border-[#111] rounded-[40px] shadow-2xl">
          {children}
        </div>
      </div>
    </CurrencyProvider>
  );
}

export function TabBar({ active }: { active: "dashboard" | "loans" | "history" | "settings" }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "M3 12L12 3l9 9M5 10v10h14V10" },
    { id: "loans", label: "Loans", icon: "M4 6h16M4 12h16M4 18h10" },
    { id: "history", label: "History", icon: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" },
  ] as const;
  return (
    <div className="shrink-0 border-t border-subtle bg-app/95 backdrop-blur-xl pt-2 pb-7 px-2 flex">
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <div key={t.id} className="flex-1 flex flex-col items-center gap-1 py-1">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isActive ? "var(--ledger-accent)" : "#5A5A5F"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            <span className="text-[10px] font-medium" style={{ color: isActive ? "var(--ledger-accent)" : "#5A5A5F" }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LtvGauge({ value, target, liquidation, size = 200, strokeWidth = 14, showZones = true }: { value: number; target: number; liquidation: number; size?: number; strokeWidth?: number; showZones?: boolean }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const arcLen = circ / 2;
  const max = liquidation;
  const pct = Math.min(value / max, 1);
  const dash = arcLen * pct;
  const color = value < target ? "var(--ledger-safe)" : value < liquidation * 0.92 ? "var(--ledger-warning)" : "var(--ledger-danger)";
  const angleFor = (v: number) => 180 + (v / max) * 180;
  const tickPos = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: size / 2 + r * Math.cos(rad), y: size / 2 + r * Math.sin(rad) };
  };
  const targetA = tickPos(angleFor(target));
  const liqA = tickPos(angleFor(liquidation));
  return (
    <svg width={size} height={size / 2 + strokeWidth} viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}>
      <path d={`M ${strokeWidth / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`} fill="none" stroke="#1F1F22" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d={`M ${strokeWidth / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${dash} ${arcLen}`} />
      {showZones && (
        <>
          <circle cx={targetA.x} cy={targetA.y} r={3} fill="#FFFFFF" />
          <circle cx={liqA.x} cy={liqA.y} r={3} fill="var(--ledger-danger)" />
        </>
      )}
    </svg>
  );
}

export function LtvRing({ value, target, liquidation, size = 80, strokeWidth = 8 }: { value: number; target: number; liquidation: number; size?: number; strokeWidth?: number }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const max = liquidation;
  const pct = Math.min(value / max, 1);
  const color = value < target ? "var(--ledger-safe)" : value < liquidation * 0.92 ? "var(--ledger-warning)" : "var(--ledger-danger)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1F1F22" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${circ * pct} ${circ}`} />
    </svg>
  );
}

export function LtvBar({ value, target, liquidation, height = 6 }: { value: number; target: number; liquidation: number; height?: number }) {
  const max = liquidation;
  const pct = (value / max) * 100;
  const targetPct = (target / max) * 100;
  const color = value < target ? "var(--ledger-safe)" : value < liquidation * 0.92 ? "var(--ledger-warning)" : "var(--ledger-danger)";
  return (
    <div className="relative w-full rounded-full bg-[#1F1F22] overflow-visible" style={{ height }}>
      <div className="absolute top-0 left-0 rounded-full" style={{ width: `${pct}%`, height: "100%", backgroundColor: color }} />
      <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white" style={{ left: `${targetPct}%` }} />
    </div>
  );
}

export function StatusPill({ status }: { status: "Healthy" | "Warning" | "Danger" }) {
  const color = status === "Healthy" ? "var(--ledger-safe)" : status === "Warning" ? "var(--ledger-warning)" : "var(--ledger-danger)";
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ backgroundColor: `${color}22` }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color }}>{status}</span>
    </div>
  );
}

// ============================================================================
// Currency (USD / ZAR) — per-screen state via context
// ============================================================================

export type Currency = "USD" | "ZAR";
export const USD_ZAR_RATE = 18.45; // Mock rate · May 2026

const CurrencyContext = React.createContext<{ c: Currency; set: (c: Currency) => void }>({
  c: "USD",
  set: () => {},
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [c, set] = React.useState<Currency>("USD");
  return <CurrencyContext.Provider value={{ c, set }}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return React.useContext(CurrencyContext);
}

export function fmtMoney(usd: number, c: Currency, decimals = 2): string {
  const value = c === "USD" ? usd : usd * USD_ZAR_RATE;
  const symbol = c === "USD" ? "$" : "R ";
  return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function CurrencyToggle() {
  const { c, set } = useCurrency();
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-surface border border-subtle">
      {(["USD", "ZAR"] as const).map(opt => (
        <button
          key={opt}
          onClick={() => set(opt)}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-md tracking-wide transition-colors"
          style={{
            backgroundColor: c === opt ? "var(--ledger-surface-elevated)" : "transparent",
            color: c === opt ? "var(--ledger-text)" : "var(--ledger-muted)",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Multi-account data model
// ============================================================================

export type Loan = {
  id: string;
  accountId: string;
  accountName: string;
  borrowAsset: string;       // e.g. "USDT"
  collateralAsset: string;   // e.g. "BTC"
  borrowed: number;          // USDT amount
  collateral: number;        // native units (BTC, ETH, BNB)
  collateralUsd: number;     // USD value of collateral
  apr: number;               // %
  ltv: number;               // %
  interest30d: number;       // USD
};

export type Account = {
  id: string;
  name: string;
  apiKeyMasked: string;
  connectedAt: string;
  portfolioUsd: number;      // total Binance equity for this account (incl. unlocked balances)
  loans: Loan[];
};

// Two Binance accounts. Loan numbers are internally consistent:
//   Main BTC : 0.412 BTC @ $77,500 ≈ $31,930   18,500 USDT → LTV 57.9%
//   Main ETH : 2.85 ETH @ $2,470  ≈ $7,040     4,200 USDT  → LTV 59.7%
//   Hedge BNB: 22.5 BNB @ $540    ≈ $12,150    6,800 USDT  → LTV 56.0%
// Aggregate: $29,500 borrowed / $51,120 collateral = LTV 57.7% → rounded to 58%
export const ACCOUNTS: Account[] = [
  {
    id: "main",
    name: "Main · Spot",
    apiKeyMasked: "A1B2···f9",
    connectedAt: "Apr 12, 2026",
    portfolioUsd: 124830.42,
    loans: [
      { id: "main-btc", accountId: "main", accountName: "Main · Spot", borrowAsset: "USDT", collateralAsset: "BTC", borrowed: 18500, collateral: 0.412, collateralUsd: 31930, apr: 7.2, ltv: 58, interest30d: 108.42 },
      { id: "main-eth", accountId: "main", accountName: "Main · Spot", borrowAsset: "USDT", collateralAsset: "ETH", borrowed: 4200,  collateral: 2.85,  collateralUsd: 7040,  apr: 6.9, ltv: 60, interest30d: 24.61 },
    ],
  },
  {
    id: "hedge",
    name: "Hedge",
    apiKeyMasked: "C3D4···k2",
    connectedAt: "May 03, 2026",
    portfolioUsd: 41250.18,
    loans: [
      { id: "hedge-bnb", accountId: "hedge", accountName: "Hedge", borrowAsset: "USDT", collateralAsset: "BNB", borrowed: 6800, collateral: 22.5, collateralUsd: 12150, apr: 7.0, ltv: 56, interest30d: 39.12 },
    ],
  },
];

export const TARGET_LTV = 65;
export const WARNING_LTV = 72;
export const LIQUIDATION_LTV = 78;

// Live collateral prices (mocked) — used for "distance to liquidation" calculations.
// Derived from the LOAN_DATA collateralUsd to stay consistent.
export const LIVE_PRICES: Record<string, number> = {
  BTC: 77500,
  ETH: 2470,
  BNB: 540,
};

// Per-loan "headroom": how much more USDT can be borrowed before hitting target LTV.
export function headroom(loan: Loan, targetLtv = TARGET_LTV): number {
  return Math.max(0, Math.round((targetLtv / 100) * loan.collateralUsd - loan.borrowed));
}

// At what collateral price does this loan reach `ltv` percent?
// LTV = borrowed / (units * price)  →  price = borrowed / (units * ltv/100)
export function priceAtLtv(loan: Loan, ltv: number): number {
  return loan.borrowed / (loan.collateral * (ltv / 100));
}

// % change from current price to the price that triggers `ltv`.
// Returns a negative number for collateral that needs to FALL (the usual case).
export function priceDropPctTo(loan: Loan, ltv: number): number {
  const current = LIVE_PRICES[loan.collateralAsset] ?? loan.collateralUsd / loan.collateral;
  const trigger = priceAtLtv(loan, ltv);
  return ((trigger - current) / current) * 100;
}

// Synthetic per-loan LTV history (most recent value = current LTV).
// `days` points, gently drifting toward current — used in sparklines.
export function ltvHistory(loan: Loan, days = 7): number[] {
  // Deterministic pseudo-noise from loan id
  const seed = loan.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (i: number) => {
    const x = Math.sin(seed * 9.31 + i * 12.7) * 10000;
    return x - Math.floor(x);
  };
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    const base = loan.ltv - (1 - t) * 3.5;
    out.push(Number((base + (rand(i) - 0.5) * 1.8).toFixed(1)));
  }
  out[out.length - 1] = loan.ltv;
  return out;
}

// Aggregate LTV history over a set of loans (weighted by borrowed amount).
export function aggLtvHistory(loans: Loan[], days = 7): number[] {
  const series = loans.map(l => ltvHistory(l, days));
  const totalBorrowed = loans.reduce((s, l) => s + l.borrowed, 0);
  return Array.from({ length: days }, (_, i) => {
    const numer = loans.reduce((s, l, idx) => {
      // Implied collateral at that day = borrowed / (ltv/100)
      const ltv = series[idx][i];
      return s + l.borrowed / (ltv / 100);
    }, 0);
    return Number(((totalBorrowed / numer) * 100).toFixed(1));
  });
}

// "Next action" — the most useful single nudge across all loans.
// If any loan is over target → top-up that one. Otherwise → the loan with biggest headroom.
export function nextAction(loans: Loan[]): { kind: "topup" | "borrow" | "none"; loan: Loan | null; usd: number; native?: number } {
  const overTarget = loans.filter(l => l.ltv > TARGET_LTV).sort((a, b) => b.ltv - a.ltv);
  if (overTarget.length > 0) {
    const loan = overTarget[0];
    const t = topUpCollateral(loan);
    return { kind: "topup", loan, usd: t.usd, native: t.native };
  }
  const byRoom = loans.map(l => ({ l, h: headroom(l) })).sort((a, b) => b.h - a.h);
  if (byRoom.length === 0) return { kind: "none", loan: null, usd: 0 };
  return { kind: "borrow", loan: byRoom[0].l, usd: byRoom[0].h };
}

// Per-loan top-up needed (in collateral asset native units) to bring LTV back to target.
// Returns 0 when already healthy.
export function topUpCollateral(loan: Loan, targetLtv = TARGET_LTV): { native: number; usd: number } {
  if (loan.ltv <= targetLtv) return { native: 0, usd: 0 };
  const requiredCollateralUsd = loan.borrowed / (targetLtv / 100);
  const deficitUsd = requiredCollateralUsd - loan.collateralUsd;
  const pricePerUnit = loan.collateralUsd / loan.collateral;
  return { native: deficitUsd / pricePerUnit, usd: deficitUsd };
}

// Aggregate computed across a set of accounts (or all of them).
export function aggregate(accounts: Account[]) {
  const loans = accounts.flatMap(a => a.loans);
  const totalBorrowed = loans.reduce((s, l) => s + l.borrowed, 0);
  const totalCollateral = loans.reduce((s, l) => s + l.collateralUsd, 0);
  const portfolioTotal = accounts.reduce((s, a) => s + a.portfolioUsd, 0);
  const interest30d = loans.reduce((s, l) => s + l.interest30d, 0);
  const currentLtv = totalCollateral > 0 ? Math.round((totalBorrowed / totalCollateral) * 100) : 0;
  const loanEquity = totalCollateral - totalBorrowed;
  const totalHeadroom = loans.reduce((s, l) => s + headroom(l), 0);
  return {
    totalBorrowed, totalCollateral, portfolioTotal, interest30d,
    currentLtv, loanEquity, totalHeadroom, loans,
    targetLtv: TARGET_LTV, liquidationLtv: LIQUIDATION_LTV,
  };
}

// Aggregate across ALL accounts. Widgets always show this.
export const ALL_AGG = aggregate(ACCOUNTS);

// Backward-compat shim so the lock/home widgets keep working unchanged.
export const LOAN_DATA = {
  targetLtv: TARGET_LTV,
  liquidationLtv: LIQUIDATION_LTV,
  currentLtv: ALL_AGG.currentLtv,
  portfolioTotal: ALL_AGG.portfolioTotal,
  delta24h: 1284.17,
  deltaPct: 1.04,
  totalCollateral: ALL_AGG.totalCollateral,
  totalBorrowed: ALL_AGG.totalBorrowed,
  loanEquity: ALL_AGG.loanEquity,
  interest30d: ALL_AGG.interest30d,
  interest7d: 40.13,
  interest90d: 534.50,
  interestAll: 1660.20,
  loans: ALL_AGG.loans,
};
