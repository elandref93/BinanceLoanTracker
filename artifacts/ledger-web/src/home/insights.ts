import type { PortfolioOverview } from "@workspace/api-client-react";

import { fmtPct, fmtSignedPct } from "@/domain/format";
import { DEFAULT_TARGET_LTV, LIQ_LTV, WARNING_LTV } from "@/domain/risk";

export type InsightTone = "gain" | "loss" | "warn" | "danger" | "info";

export type Insight = {
  id: string;
  tone: InsightTone;
  title: string;
  body?: string;
  to?: string;
  /** Higher shows first. Danger outranks everything; market colour comes last. */
  score: number;
};

type Format = {
  /** Signed, whole display-currency amount, for example "+R38 200". */
  signed: (usd: number) => string;
  /** Whole display-currency amount, for example "R4 200". */
  amount: (usd: number) => string;
  profileName: (containerId: string) => string;
};

const STABLE = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD", "USD", "ZAR"]);

/**
 * Ranked, rule-based cards for Home. Every rule reads only what the server
 * returned, so a missing figure drops the card rather than inventing one.
 */
export function homeInsights(overview: PortfolioOverview, format: Format, limit = 3): Insight[] {
  const out: Insight[] = [];

  for (const profile of overview.profiles) {
    if (profile.ltv == null) continue;
    const target = profile.targetLtv ?? DEFAULT_TARGET_LTV;
    const name = format.profileName(profile.containerId);
    if (profile.ltv >= WARNING_LTV) {
      out.push({
        id: `ltv-danger-${profile.containerId}`,
        tone: "danger",
        title: `${name} LTV is ${fmtPct(profile.ltv)}`,
        body: profile.ltv >= LIQ_LTV ? "At or past the liquidation level." : `Margin call starts at ${WARNING_LTV}%. Liquidation at ${LIQ_LTV}%.`,
        to: "/loans",
        score: 1000 + profile.ltv,
      });
    } else if (profile.ltv >= target) {
      out.push({
        id: `ltv-above-${profile.containerId}`,
        tone: "warn",
        title: `${name} LTV ${fmtPct(profile.ltv)} is above its ${fmtPct(target, 0)} target`,
        body: `${fmtPct(profile.ltv - target)} points over target.`,
        to: "/loans",
        score: 800 + profile.ltv - target,
      });
    }
  }

  const accountErrors = overview.flags.includes("account_errors");
  if (accountErrors) {
    out.push({
      id: "account-errors",
      tone: "warn",
      title: "Some accounts did not respond",
      body: "Totals may be missing those balances until the next refresh.",
      to: "/settings/accounts",
      score: 700,
    });
  }

  const weekAttribution = overview.week.attribution;
  const driver = weekAttribution?.byAsset.find((item) => !STABLE.has(item.asset));
  if (driver && overview.totals.netUsd > 0 && Math.abs(driver.marketUsd) >= Math.max(50, overview.totals.netUsd * 0.005)) {
    const holding = overview.allocation.find((slice) => slice.asset === driver.asset)?.usd ?? 0;
    const base = holding - driver.marketUsd;
    const pct = base > 0 ? (driver.marketUsd / base) * 100 : null;
    out.push({
      id: `driver-${driver.asset}`,
      tone: driver.marketUsd >= 0 ? "gain" : "loss",
      title: `${driver.asset}${pct != null ? ` ${fmtSignedPct(pct)}` : ""} this week ${driver.marketUsd >= 0 ? "added" : "took"} ${format.signed(driver.marketUsd)}`,
      body: "Price moves on what you hold, net of loans in the same coin.",
      to: `/portfolio/${encodeURIComponent(driver.asset)}`,
      score: 400 + Math.min(200, (Math.abs(driver.marketUsd) / Math.max(1, overview.totals.netUsd)) * 2000),
    });
  }

  const todayPct = overview.today.pct;
  if (todayPct != null && Math.abs(todayPct) >= 3) {
    out.push({
      id: "today-move",
      tone: todayPct >= 0 ? "gain" : "loss",
      title: `Net worth ${todayPct >= 0 ? "up" : "down"} ${fmtPct(Math.abs(todayPct))} today`,
      body: overview.today.pnlUsd != null ? `${format.signed(overview.today.pnlUsd)} since midnight.` : undefined,
      score: 450 + Math.abs(todayPct) * 10,
    });
  }

  const top = overview.allocation[0];
  if (top && !STABLE.has(top.asset) && top.pct >= 60 && overview.allocation.length > 0) {
    out.push({
      id: `concentration-${top.asset}`,
      tone: "info",
      title: `${top.asset} is ${fmtPct(top.pct, 0)} of your assets`,
      body: "A single-coin portfolio moves with that coin. The Insights tab shows a stress test.",
      to: "/insights",
      score: 300 + top.pct,
    });
  }

  const monthlyInterest = overview.loans.dailyInterestUsd * 30;
  if (overview.loans.count > 0 && monthlyInterest >= 1) {
    out.push({
      id: "interest-cost",
      tone: "info",
      title: `Loans cost about ${format.amount(monthlyInterest)} a month in interest`,
      body: `Across ${overview.loans.count} open ${overview.loans.count === 1 ? "loan" : "loans"} at today's rates.`,
      to: "/insights",
      score: 250,
    });
  }

  if (overview.import.flaggedCount > 0) {
    out.push({
      id: "reconciliation",
      tone: "info",
      title: `${overview.import.flaggedCount} ${overview.import.flaggedCount === 1 ? "balance needs" : "balances need"} a check`,
      body: "History could not fully explain a current balance, so P&L marks those periods as lower confidence.",
      to: "/settings/diagnostics",
      score: 200,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
