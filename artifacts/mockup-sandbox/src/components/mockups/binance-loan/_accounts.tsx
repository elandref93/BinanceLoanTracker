import React from "react";
import { ChevronLeft } from "lucide-react";

// ============================================================================
// Owner-account hierarchy:  Owner Account → Exchange Service → Loans / Assets
//   Personal ─┬─ Binance (loans)
//             └─ Luno    (spot assets)
//   Trust    ─── Binance (loans)
// ============================================================================

export type Exchange = "Binance" | "Luno";

export type Service = {
  id: string;
  exchange: Exchange;
  label: string;          // "Spot · read-only"
  apiKeyMasked: string;
  status: "live" | "error";
  syncedAgo: string;
  collateralUsd: number;  // value backing loans (0 if none)
  borrowedUsd: number;    // 0 if no loans
  assetsUsd: number;      // non-loan holdings
};

export type Triggers = {
  target: number;
  warning: number;
  danger: number;
};

export type Alerts = {
  warning: boolean;
  danger: boolean;
  daily: boolean;
};

export type OwnerAccount = {
  id: string;
  name: string;
  kind: "Personal" | "Trust" | "Company";
  services: Service[];
  triggers: Triggers;
  alerts: Alerts;
};

export const LIQUIDATION = 78;

export const OWNER_ACCOUNTS: OwnerAccount[] = [
  {
    id: "personal",
    name: "Personal",
    kind: "Personal",
    triggers: { target: 65, warning: 72, danger: 76 },
    alerts: { warning: true, danger: true, daily: true },
    services: [
      { id: "p-binance", exchange: "Binance", label: "Spot · read-only", apiKeyMasked: "A1B2···f9", status: "live", syncedAgo: "2m ago", collateralUsd: 51120, borrowedUsd: 29500, assetsUsd: 124830 },
      { id: "p-luno",    exchange: "Luno",    label: "Wallet · read-only", apiKeyMasked: "9F3C···a4", status: "live", syncedAgo: "5m ago", collateralUsd: 0,     borrowedUsd: 0,     assetsUsd: 18400 },
    ],
  },
  {
    id: "trust",
    name: "Trust",
    kind: "Trust",
    triggers: { target: 55, warning: 65, danger: 72 },
    alerts: { warning: true, danger: true, daily: false },
    services: [
      { id: "t-binance", exchange: "Binance", label: "Spot · read-only", apiKeyMasked: "C3D4···k2", status: "live", syncedAgo: "8m ago", collateralUsd: 38000, borrowedUsd: 19000, assetsUsd: 64200 },
    ],
  },
];

export function serviceLtv(s: Service): number {
  return s.collateralUsd > 0 ? Math.round((s.borrowedUsd / s.collateralUsd) * 100) : 0;
}

export function accountTotals(a: OwnerAccount) {
  const collateral = a.services.reduce((s, x) => s + x.collateralUsd, 0);
  const borrowed = a.services.reduce((s, x) => s + x.borrowedUsd, 0);
  const assets = a.services.reduce((s, x) => s + x.assetsUsd, 0);
  const ltv = collateral > 0 ? Math.round((borrowed / collateral) * 100) : 0;
  // Net equity = everything held on the exchanges (collateral + free assets) minus what's borrowed.
  const netEquity = collateral + assets - borrowed;
  const headroom = Math.max(0, Math.round((a.triggers.target / 100) * collateral - borrowed));
  return { collateral, borrowed, assets, ltv, netEquity, headroom };
}

export function statusFor(ltv: number, t: Triggers): "Healthy" | "Warning" | "Danger" {
  if (ltv === 0) return "Healthy";
  if (ltv < t.warning) return "Healthy";
  if (ltv < t.danger) return "Warning";
  return "Danger";
}

export function getAccount(id: string): OwnerAccount {
  return OWNER_ACCOUNTS.find(a => a.id === id) ?? OWNER_ACCOUNTS[0];
}

// Brand mark for an exchange (initial in a tinted square).
export function ExchangeMark({ exchange, size = 36 }: { exchange: Exchange; size?: number }) {
  const tint = exchange === "Binance" ? "#F0B90B" : "#0066FF";
  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0 font-semibold"
      style={{ width: size, height: size, backgroundColor: `${tint}22`, color: tint, fontSize: size * 0.42 }}
    >
      {exchange === "Binance" ? "B" : "L"}
    </div>
  );
}

// Top navigation header for pushed (drill-in) screens.
export function NavHeader({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return (
    <div className="px-3 pt-1 pb-3 shrink-0 flex items-center gap-2">
      <button className="w-8 h-8 -ml-1 rounded-full flex items-center justify-center" style={{ color: "var(--ledger-muted)" }}>
        <ChevronLeft className="w-6 h-6" />
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight text-primary leading-tight truncate">{title}</h1>
        {subtitle && <div className="text-[11px] text-muted truncate">{subtitle}</div>}
      </div>
      {trailing}
    </div>
  );
}

// Bottom tab bar that mirrors the real app (Home · Crypto · Interest · Strategy · Settings).
export function BottomNav({ active }: { active: "home" | "crypto" | "interest" | "strategy" | "settings" }) {
  const tabs = [
    { id: "home",     label: "Home",     icon: "M3 12L12 3l9 9M5 10v10h14V10" },
    { id: "crypto",   label: "Crypto",   icon: "M12 2v20M7 5h7a3.5 3.5 0 010 7H7m0 0h8a3.5 3.5 0 010 7H7" },
    { id: "interest", label: "Interest", icon: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "strategy", label: "Strategy", icon: "M3 17l5-5 4 4 7-8M21 8V3h-5" },
    { id: "settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" },
  ] as const;
  return (
    <div className="shrink-0 border-t border-subtle bg-app/95 backdrop-blur-xl pt-2 pb-7 px-1 flex">
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <div key={t.id} className="flex-1 flex flex-col items-center gap-1 py-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isActive ? "var(--ledger-accent)" : "#5A5A5F"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            <span className="text-[9px] font-medium" style={{ color: isActive ? "var(--ledger-accent)" : "#5A5A5F" }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Small section header + rounded container, matching the Settings mockup.
export function Section({ title, children, trailing }: { title: string; children: React.ReactNode; trailing?: React.ReactNode }) {
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

export function Toggle({ on }: { on: boolean }) {
  return (
    <div className="w-[44px] h-[26px] rounded-full p-[2px] transition-colors shrink-0" style={{ backgroundColor: on ? "var(--ledger-safe)" : "#1F1F22" }}>
      <div className="w-[22px] h-[22px] rounded-full bg-white transition-transform" style={{ transform: on ? "translateX(18px)" : "translateX(0)" }} />
    </div>
  );
}
