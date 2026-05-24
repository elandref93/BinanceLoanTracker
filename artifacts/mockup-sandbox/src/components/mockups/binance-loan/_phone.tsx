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
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="ledger-theme w-[390px] h-[844px] relative bg-app overflow-hidden flex flex-col border border-[#111] rounded-[40px] shadow-2xl">
        {children}
      </div>
    </div>
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
  // semi-circle: start at 180deg, sweep 180deg
  const arcLen = circ / 2;
  const max = liquidation;
  const pct = Math.min(value / max, 1);
  const dash = arcLen * pct;
  const color = value < target ? "var(--ledger-safe)" : value < liquidation * 0.92 ? "var(--ledger-warning)" : "var(--ledger-danger)";

  // Tick positions (in degrees from left, 180 to 360)
  const angleFor = (v: number) => 180 + (v / max) * 180;
  const tickPos = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x: size / 2 + r * Math.cos(rad),
      y: size / 2 + r * Math.sin(rad),
    };
  };
  const targetA = tickPos(angleFor(target));
  const liqA = tickPos(angleFor(liquidation));

  return (
    <svg width={size} height={size / 2 + strokeWidth} viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}>
      {/* Track */}
      <path
        d={`M ${strokeWidth / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
        fill="none"
        stroke="#1F1F22"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Value */}
      <path
        d={`M ${strokeWidth / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${arcLen}`}
      />
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
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${circ * pct} ${circ}`}
      />
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

// Numbers are internally consistent:
//   Loan 1: 0.412 BTC @ $77,500 ≈ $31,930 collateral; $18,500 borrowed → LTV 57.9%
//   Loan 2: 2.85 ETH @ $2,470 ≈ $7,040 collateral;    $4,200 borrowed  → LTV 59.7%
//   Aggregate collateral $38,970; borrowed $22,700 → LTV 58.2% (rounded to 58%)
//   Portfolio total (incl. unlocked balances) $124,830.42
export const LOAN_DATA = {
  targetLtv: 65,
  currentLtv: 58,
  liquidationLtv: 78,
  portfolioTotal: 124830.42,
  delta24h: 1284.17,
  deltaPct: 1.04,
  totalCollateral: 38970,
  totalBorrowed: 22700,
  loanEquity: 16270, // collateral - borrowed
  interest30d: 133.03,
  interest7d: 31.07,
  interest90d: 412.86,
  interestAll: 1284.41,
  loans: [
    { id: 1, borrowAsset: "USDT", collateralAsset: "BTC", borrowed: 18500, collateral: 0.412, collateralUsd: 31930, apr: 7.2, ltv: 58, interest30d: 108.42 },
    { id: 2, borrowAsset: "USDT", collateralAsset: "ETH", borrowed: 4200,  collateral: 2.85,  collateralUsd: 7040,  apr: 6.9, ltv: 60, interest30d: 24.61 },
  ],
};
