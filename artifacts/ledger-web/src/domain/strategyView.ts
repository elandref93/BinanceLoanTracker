/**
 * Display helpers for the strategy simulator. Money formatting and the
 * live-position guard live here. compute() itself is not reimplemented.
 */

import type { Loan } from "@workspace/api-client-react";

import { fmtDate, fmtDisplayMoney, getUsdToZar, JOHANNESBURG_TIME_ZONE, setUsdToZar } from "@/domain/format";
import {
  snapshotFromLoans,
  type LeverageInputs,
  type LeverageResult,
  type YearRowA,
  type YearRowB,
} from "@/domain/leverageSim";
import { RATE_UNAVAILABLE } from "@/domain/portfolio";

export type SimCurrency = "USD" | "ZAR";

export type DisplayPosition = {
  collateralZar: number | null;
  weightedAprPct: number | null;
  currentLtvPct: number | null;
  /** Collateral value was returned, and no snapshot USD/ZAR rate was available. */
  needsRate: boolean;
};

export function formatSimMoney(zar: number, currency: SimCurrency, fx: number | null): string {
  if (!Number.isFinite(zar)) return "—";
  if (currency === "ZAR") return fmtDisplayMoney(zar, "ZAR", { whole: true });
  if (fx == null || !(fx > 0)) return RATE_UNAVAILABLE;
  return fmtDisplayMoney(zar / fx, "USD", { whole: true });
}

/**
 * APR and LTV come from the loan list. Collateral is converted to ZAR only
 * when a snapshot rate was returned. The baked-in formatter default is not
 * used as a stand-in rate.
 */
export function positionForDisplay(loans: Loan[] | null | undefined, fx: number | null): DisplayPosition {
  const rate = fx != null && Number.isFinite(fx) && fx > 0 ? fx : null;
  const previous = getUsdToZar();
  if (rate != null) setUsdToZar(rate);
  try {
    const snap = snapshotFromLoans(loans);
    const convertible = snap.collateralZar != null && snap.collateralZar !== 0;
    if (rate == null) {
      return {
        collateralZar: snap.collateralZar === 0 ? 0 : null,
        weightedAprPct: snap.weightedAprPct,
        currentLtvPct: snap.currentLtvPct,
        needsRate: convertible,
      };
    }
    return {
      collateralZar: snap.collateralZar,
      weightedAprPct: snap.weightedAprPct,
      currentLtvPct: snap.currentLtvPct,
      needsRate: false,
    };
  } finally {
    setUsdToZar(previous);
  }
}

export function inputsFromLivePosition(
  inputs: LeverageInputs,
  position: Pick<DisplayPosition, "collateralZar" | "weightedAprPct" | "currentLtvPct">,
): LeverageInputs | null {
  if (position.collateralZar == null) return null;
  return {
    ...inputs,
    startingCapital: Math.round(position.collateralZar),
    borrowCost:
      position.weightedAprPct != null
        ? Math.round(position.weightedAprPct * 10) / 10
        : inputs.borrowCost,
    ltv:
      position.currentLtvPct != null
        ? Math.min(80, Math.max(10, Math.round(position.currentLtvPct)))
        : inputs.ltv,
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function johannesburgMonth(now: Date): number {
  if (Number.isNaN(now.getTime())) return 1;
  const month = new Intl.DateTimeFormat("en-ZA", {
    timeZone: JOHANNESBURG_TIME_ZONE,
    month: "numeric",
  })
    .formatToParts(now)
    .find((part) => part.type === "month")?.value;
  const parsed = Number(month);
  return parsed >= 1 && parsed <= 12 ? parsed : 1;
}

export function saTaxYearOn(inputs: LeverageInputs): boolean {
  return (inputs.rebalanceMonth ?? 1) === 2;
}

export function toggleSaTaxYear(inputs: LeverageInputs, now: Date): LeverageInputs {
  if (saTaxYearOn(inputs)) return { ...inputs, startMonth: 1, rebalanceMonth: 1 };
  return { ...inputs, startMonth: johannesburgMonth(now), rebalanceMonth: 2 };
}

export function rateCrossoverYear(rowsA: YearRowA[], rowsB: YearRowB[]): number | null {
  for (let i = 1; i < rowsA.length; i++) {
    const currentA = rowsA[i];
    const previousA = rowsA[i - 1];
    const currentB = rowsB[i];
    const previousB = rowsB[i - 1];
    if (!currentA || !previousA || !currentB || !previousB) continue;
    if (currentA.growthRate < currentB.growthRate && previousA.growthRate >= previousB.growthRate) {
      return currentA.year;
    }
  }
  return null;
}

export function chartSummary(result: LeverageResult, currency: SimCurrency, fx: number | null): string {
  const lastA = result.rowsA[result.rowsA.length - 1];
  const lastB = result.rowsB[result.rowsB.length - 1];
  if (!lastA || !lastB) return "The simulation did not produce a year row.";
  return `Year ${lastA.year}. A net ${formatSimMoney(lastA.net, currency, fx)}. B net ${formatSimMoney(lastB.net, currency, fx)}.`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSummaryHtml(input: {
  title: string;
  inputs: LeverageInputs;
  result: LeverageResult;
  currency: SimCurrency;
  fx: number | null;
  generatedAt: Date;
}): string {
  const money = (zar: number) => formatSimMoney(zar, input.currency, input.fx);
  const lastA = input.result.rowsA[input.result.rowsA.length - 1];
  const lastB = input.result.rowsB[input.result.rowsB.length - 1];
  const taxLabel =
    input.inputs.taxMode === "trust"
      ? "Trust (36%)"
      : input.inputs.taxMode === "taxfree"
        ? "Tax-Free (0%)"
        : "Personal (18%)";
  const rows = input.result.rowsA
    .map((rowA, index) => {
      const rowB = input.result.rowsB[index];
      if (!rowB) return "";
      const delta = rowA.net - rowB.net;
      return `<tr><td>${rowA.year}</td><td>${escapeHtml(money(rowA.net))}</td><td>${escapeHtml(money(rowB.net))}</td><td>${escapeHtml(money(rowA.amcTax))}</td><td>${escapeHtml(money(delta))}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(input.title)}</title></head><body>
<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(taxLabel)} · Horizon ${input.inputs.years}y · Display ${input.currency}</p>
<p>A net ${escapeHtml(money(lastA?.net ?? 0))} · B net ${escapeHtml(money(lastB?.net ?? 0))} · Total tax ${escapeHtml(money(input.result.totTaxA))}</p>
<p>Generated ${escapeHtml(fmtDate(input.generatedAt))} (Africa/Johannesburg). Personal simulation — not financial advice.</p>
<table><tbody>${rows}</tbody></table>
</body></html>`;
}
