import type { LunoTransaction } from "@workspace/api-client-react";

import { fmtDate, fmtDisplayMoney, fmtPct, fmtQty, fmtUsd, groupWithSpaces } from "@/domain/format";
import {
  filterLunoTxsForContainer,
  lunoFundingForAsset,
  matchRepaymentsToBuys,
  type LunoContainerLinks,
} from "@/domain/lunoFunding";
import {
  canDeriveCollateralPrice,
  headroomToTarget,
  LIQ_LTV,
  priceAtLtv,
  priceDropPctTo,
  statusFromLtv,
  statusLabel,
  WARNING_LTV,
  type RiskLoan,
  type Status,
} from "@/domain/risk";

export const HOURS_PER_YEAR = 24 * 365;
const DAYS_PER_MONTH = 30.44;
const MAX_PAYOFF_MONTHS = 600;

export const SIM_STEPS = [5, 10, 20, 30, 40] as const;

export const LOAN_LOADING = "Loading the saved snapshot…";
export const LOAN_SNAPSHOT_ERROR = "The snapshot could not be loaded. This loan is not shown.";
export const LOAN_SNAPSHOT_MISSING =
  "No LTV snapshot is stored for this session. This loan is not shown.";
export const LOAN_SNAPSHOT_UNREADABLE =
  "The stored snapshot could not be read. This loan is not shown.";
export const LOAN_MISSING = "This loan is not in the saved snapshot.";
export const LOANS_ABSENT = "Loans are not included in this snapshot.";
export const LOAN_UNREADABLE = "This loan could not be read from the snapshot.";
export const RATE_UNAVAILABLE = "Exchange rate is not in this snapshot";
export const COLLATERAL_QTY_UNAVAILABLE = "Collateral quantity is not in this snapshot.";
export const BORROWED_QTY_UNAVAILABLE = "Borrowed quantity is not in this snapshot.";
export const PRICE_TRIGGER_UNAVAILABLE =
  "Warning and liquidation prices are unavailable because this snapshot has no collateral quantity.";
export const PRICE_TRIGGER_CHECKING =
  "Collateral quantity is not in this snapshot. Checking the live loan before showing a price.";
export const PRICE_TRIGGER_LIVE_ERROR =
  "Collateral quantity is not in this snapshot, and the live loan could not be loaded.";
export const INTEREST_UNAVAILABLE =
  "Hourly and daily interest are unavailable because this loan has no interest rate.";
export const INTEREST_FROM_APR =
  "Hourly and daily interest are projected from the APR and USD debt returned for this loan. A live hourly rate was not returned.";
export const INTEREST_FROM_HOURLY = "Hourly and daily interest use the live hourly rate returned for this loan.";
export const REPAYMENTS_NO_KEY =
  "Repayment history is not in this snapshot. No Binance key is stored for this session, so repayments are not loaded.";
export const REPAYMENTS_STORAGE =
  "Repayment history is unavailable. Server credential storage is not configured, and this snapshot does not include repayments.";
export const REPAYMENTS_EMPTY = "No repayments recorded for this loan.";
export const REPAYMENTS_ERROR = "Repayment history could not be loaded.";
export const REPAYMENTS_LOADING = "Loading repayment history…";
export const LUNO_NO_PROFILE =
  "This loan's profile is not in the synced account list, so Luno funding cannot be scoped to one profile.";
export const LUNO_NO_LINK = "No Luno account is linked to this profile, so Luno funding is not loaded.";
export const LUNO_NO_KEY =
  "Luno funding is not in this snapshot. No Luno key is stored for this session, so funding activity is not loaded.";
export const LUNO_STORAGE =
  "Luno funding is unavailable. Server credential storage is not configured, and this snapshot does not include Luno activity.";
export const LUNO_EMPTY_PREFIX = "No Luno buys or transfers found for";
export const LUNO_ERROR = "Luno activity could not be loaded.";
export const LUNO_LOADING = "Loading Luno activity…";
export const PAYOFF_UNAVAILABLE =
  "A payoff schedule needs the borrowed quantity. This snapshot does not include it, so the schedule is not shown. Repayment notes are still saved on the server.";
export const COLLATERAL_PLAN_UNAVAILABLE =
  "A collateral-build projection needs a collateral quantity and a collateral price. This snapshot includes neither, so that projection is not shown. The monthly collateral amount is still saved on the server.";
export const DEBT_GROWTH_NOTE =
  "Projected by adding the daily interest to the current debt. Future repayments are not subtracted.";

export type SnapshotLoanSource = {
  id: string;
  accountId: string;
  asset: string;
  debtUsd: number;
  collateralAsset: string;
  collateralValueUsd: number;
  ltv: number;
  apr: number;
};

export type LiveLoanSource = {
  accountId: string;
  asset: string;
  collateralAsset: string;
  debtQty: number | null;
  debtUsd: number | null;
  collateralQty: number | null;
  collateralValueUsd: number | null;
  ltv: number | null;
  apr: number | null;
  hourlyInterestRate: number | null;
};

export type LoanEvent = {
  type: "borrow" | "repay";
  ts: string;
  asset: string;
  amount: number;
  amountUsd: number | null;
};

export type SectionGate =
  | { status: "pending" }
  | { status: "blocked"; reason: "no-key" | "storage" | "no-profile" | "no-link" }
  | { status: "error" }
  | { status: "ready" };

export type PositionRow = { label: string; value: string };

export type SimCell = {
  changeLabel: string;
  ltvLabel: string;
  status: Status;
  liquidated: boolean;
};

export type RepaymentRow = {
  amount: string;
  when: string;
  funding: string | null;
  value: string | null;
};

export type FundingRow = {
  kind: "buy" | "move";
  amount: string;
  detail: string;
  value: string | null;
};

export type LoanDetailView = {
  title: string;
  accountLabel: string;
  asOfLabel: string | null;
  ltv: string;
  status: Status;
  statusText: string;
  position: PositionRow[];
  priceNote: string | null;
  warningPrice: string | null;
  liquidationPrice: string | null;
  apr: string | null;
  hourlyRate: string | null;
  hourlyInterest: string | null;
  dailyInterest: string | null;
  interestNote: string | null;
  debtGrowth: { label: string; value: string }[] | null;
  debtGrowthNote: string | null;
  currentPrice: string | null;
  currentPriceNote: string | null;
  falls: SimCell[];
  rises: SimCell[];
  repaymentsNote: string | null;
  repayments: RepaymentRow[] | null;
  lunoNote: string | null;
  lunoBuys: FundingRow[] | null;
  lunoMoves: FundingRow[] | null;
  lunoScope: string | null;
  debtQty: number | null;
  debtUsd: number;
  rateDecimal: number | null;
};

export type LoanDetailResult =
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "loan"; view: LoanDetailView };

type ResolvedLoan = {
  accountId: string;
  asset: string;
  collateralAsset: string;
  debtUsd: number;
  collateralValueUsd: number;
  ltv: number;
  apr: number | null;
  debtQty: number | null;
  collateralQty: number | null;
  hourlyInterestRate: number | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: number | null | undefined): number | null {
  return finite(value) && value > 0 ? value : null;
}

export function money(usd: number, currency: "USD" | "ZAR", fx: number | null): string {
  if (!finite(usd)) return "—";
  if (currency === "USD") return fmtUsd(usd);
  if (fx == null || fx <= 0) return RATE_UNAVAILABLE;
  return fmtDisplayMoney(usd * fx, "ZAR");
}

export function simulatedLtv(currentLtv: number, changePercent: number): number {
  return currentLtv / (1 + changePercent / 100);
}

export function monthsToSettle(
  principal: number,
  monthlyRate: number,
  contribution: number,
): number | null {
  if (principal <= 0) return 0;
  if (contribution <= 0) return null;
  let balance = principal;
  for (let month = 1; month <= MAX_PAYOFF_MONTHS; month += 1) {
    balance = balance * (1 + monthlyRate) - contribution;
    if (balance <= 0) return month;
  }
  return null;
}

export function requiredMonthly(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) return principal;
  if (monthlyRate <= 1e-9) return principal / months;
  const factor = (1 + monthlyRate) ** -months;
  return (principal * monthlyRate) / (1 - factor);
}

function johannesburgParts(value: Date): { year: number; month: number; day: number } | null {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!finite(year) || !finite(month) || !finite(day)) return null;
  return { year, month, day };
}

function addJohannesburgMonths(from: Date, months: number): Date {
  const parts = johannesburgParts(from);
  if (!parts) return from;
  return new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day, 12));
}

export type PayoffProjection =
  | { available: false; reason: string }
  | {
      available: true;
      monthlyInterest: string;
      months: number | null;
      payoffDate: string | null;
      monthsNote: string;
      requiredForDate: string | null;
    };

export function payoffProjection(input: {
  debtQty: number | null;
  debtUsd: number | null;
  hourlyRate: number | null;
  contribution: number | null;
  targetDate: string | null;
  currency: "USD" | "ZAR";
  fx: number | null;
  now?: Date;
}): PayoffProjection {
  const debtQty = positive(input.debtQty);
  const hourlyRate = positive(input.hourlyRate);
  if (debtQty == null || hourlyRate == null) {
    return { available: false, reason: PAYOFF_UNAVAILABLE };
  }
  if (input.currency === "ZAR" && (input.fx == null || input.fx <= 0)) {
    return {
      available: false,
      reason: "A payoff schedule in rand needs the USD/ZAR rate from this snapshot.",
    };
  }
  const debtUsd = positive(input.debtUsd);
  const assetToUsd = debtUsd != null ? debtUsd / debtQty : null;
  if (assetToUsd == null || assetToUsd <= 0) {
    return { available: false, reason: PAYOFF_UNAVAILABLE };
  }
  const monthlyRate = hourlyRate * 24 * DAYS_PER_MONTH;
  const monthlyInterestAsset = debtQty * monthlyRate;
  const contribution = input.contribution;
  const contributionAsset =
    contribution == null || contribution <= 0
      ? 0
      : input.currency === "ZAR"
        ? contribution / ((input.fx ?? 0) * assetToUsd)
        : contribution / assetToUsd;
  const months = contributionAsset > 0 ? monthsToSettle(debtQty, monthlyRate, contributionAsset) : null;
  const now = input.now ?? new Date();
  const payoffDate =
    months != null && months > 0 ? fmtDate(addJohannesburgMonths(now, months)) : null;
  let requiredForDate: string | null = null;
  if (input.targetDate && /^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) {
    const [year, month, day] = input.targetDate.split("-").map(Number);
    const target = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
    const span = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH);
    const targetMonths = Math.max(1, Math.round(span));
    if (span > 0) {
      const requiredAsset = requiredMonthly(debtQty, monthlyRate, targetMonths);
      const requiredDisplay = input.currency === "ZAR" ? requiredAsset * assetToUsd * (input.fx ?? 0) : requiredAsset * assetToUsd;
      requiredForDate = money(requiredDisplay, input.currency, input.fx);
    }
  }
  const monthsNote =
    contributionAsset <= 0
      ? "Enter a monthly contribution to project a payoff date."
      : months == null
        ? "This contribution does not clear the debt within 600 months."
        : `About ${months} months, settling ${payoffDate ?? ""}.`.trim();
  return {
    available: true,
    monthlyInterest: money(monthlyInterestAsset * assetToUsd, input.currency, input.fx),
    months,
    payoffDate,
    monthsNote,
    requiredForDate,
  };
}

function readableSnapshotLoan(loan: SnapshotLoanSource | null): SnapshotLoanSource | null {
  if (!loan) return null;
  if (
    !loan.id ||
    !finite(loan.debtUsd) ||
    !finite(loan.collateralValueUsd) ||
    !finite(loan.ltv) ||
    !finite(loan.apr)
  ) {
    return null;
  }
  return loan;
}

function resolveLoan(
  snapshotLoan: SnapshotLoanSource | null,
  liveLoan: LiveLoanSource | null,
): ResolvedLoan | null {
  const snapshot = readableSnapshotLoan(snapshotLoan);
  if (!snapshot && !liveLoan) return null;
  const debtUsd = positive(liveLoan?.debtUsd) ?? (snapshot ? snapshot.debtUsd : null);
  const collateralValueUsd =
    positive(liveLoan?.collateralValueUsd) ?? (snapshot ? snapshot.collateralValueUsd : null);
  const ltv = positive(liveLoan?.ltv) ?? (snapshot && snapshot.ltv >= 0 ? snapshot.ltv : null);
  if (debtUsd == null || collateralValueUsd == null || ltv == null) return null;
  const apr = positive(liveLoan?.apr) ?? (snapshot && snapshot.apr > 0 ? snapshot.apr : snapshot ? snapshot.apr : null);
  return {
    accountId: liveLoan?.accountId || snapshot?.accountId || "",
    asset: (liveLoan?.asset || snapshot?.asset || "").trim() || "Loan",
    collateralAsset: (liveLoan?.collateralAsset || snapshot?.collateralAsset || "").trim(),
    debtUsd,
    collateralValueUsd,
    ltv,
    apr: finite(apr) ? apr : null,
    debtQty: positive(liveLoan?.debtQty),
    collateralQty: positive(liveLoan?.collateralQty),
    hourlyInterestRate: positive(liveLoan?.hourlyInterestRate),
  };
}

type Interest =
  | { available: false }
  | { available: true; source: "hourly" | "apr"; hourlyUsd: number; dailyUsd: number; hourlyRate: number };

function interestFor(loan: ResolvedLoan): Interest {
  if (
    loan.hourlyInterestRate != null &&
    loan.debtQty != null &&
    loan.debtUsd > 0
  ) {
    const hourlyUsd = loan.debtQty * loan.hourlyInterestRate * (loan.debtUsd / loan.debtQty);
    return {
      available: true,
      source: "hourly",
      hourlyUsd,
      dailyUsd: hourlyUsd * 24,
      hourlyRate: loan.hourlyInterestRate,
    };
  }
  if (loan.apr != null && loan.apr > 0) {
    const hourlyRate = loan.apr / 100 / HOURS_PER_YEAR;
    const hourlyUsd = loan.debtUsd * hourlyRate;
    return { available: true, source: "apr", hourlyUsd, dailyUsd: hourlyUsd * 24, hourlyRate };
  }
  return { available: false };
}

function simCells(ltv: number, targetLtv: number, direction: 1 | -1): SimCell[] {
  return SIM_STEPS.map((step) => {
    const changePercent = direction * step;
    const projected = simulatedLtv(ltv, changePercent);
    const status = statusFromLtv(projected, targetLtv);
    const liquidated = projected >= LIQ_LTV;
    return {
      changeLabel: `${direction > 0 ? "+" : "−"}${step}%`,
      ltvLabel: liquidated ? "Liquidation" : fmtPct(projected, 0),
      status,
      liquidated,
    };
  });
}

function pricePair(loan: ResolvedLoan, currency: "USD" | "ZAR", fx: number | null): {
  note: string | null;
  warning: string | null;
  liquidation: string | null;
  currentPrice: string | null;
  currentPriceNote: string | null;
} {
  const risk: RiskLoan = {
    id: "loan",
    debtUsd: loan.debtUsd,
    ltv: loan.ltv,
    collateral: {
      asset: loan.collateralAsset || "collateral",
      qty: loan.collateralQty ?? 0,
      valueUsd: loan.collateralValueUsd,
    },
  };
  if (!canDeriveCollateralPrice(risk)) {
    return {
      note: null,
      warning: null,
      liquidation: null,
      currentPrice: null,
      currentPriceNote: COLLATERAL_QTY_UNAVAILABLE,
    };
  }
  const warningPrice = priceAtLtv(risk, WARNING_LTV);
  const liquidationPrice = priceAtLtv(risk, LIQ_LTV);
  const warningDrop = priceDropPctTo(risk, WARNING_LTV);
  const liquidationDrop = priceDropPctTo(risk, LIQ_LTV);
  const now = loan.collateralValueUsd / (loan.collateralQty ?? 1);
  return {
    note: null,
    warning: `${money(warningPrice, currency, fx)} · ${fmtPct(warningDrop, 1)} from now`,
    liquidation: `${money(liquidationPrice, currency, fx)} · ${fmtPct(liquidationDrop, 1)} from now`,
    currentPrice: money(now, currency, fx),
    currentPriceNote: null,
  };
}

function repaymentGateMessage(gate: SectionGate): string | null {
  if (gate.status === "pending") return REPAYMENTS_LOADING;
  if (gate.status === "error") return REPAYMENTS_ERROR;
  if (gate.status === "blocked" && gate.reason === "storage") return REPAYMENTS_STORAGE;
  if (gate.status === "blocked") return REPAYMENTS_NO_KEY;
  return null;
}

function lunoGateMessage(gate: SectionGate, asset: string): string | null {
  if (gate.status === "pending") return LUNO_LOADING;
  if (gate.status === "error") return LUNO_ERROR;
  if (gate.status === "blocked" && gate.reason === "no-profile") return LUNO_NO_PROFILE;
  if (gate.status === "blocked" && gate.reason === "no-link") return LUNO_NO_LINK;
  if (gate.status === "blocked" && gate.reason === "storage") return LUNO_STORAGE;
  if (gate.status === "blocked") return LUNO_NO_KEY;
  return `${LUNO_EMPTY_PREFIX} ${asset || "this asset"}.`;
}

function eventValue(amountUsd: number | null, currency: "USD" | "ZAR", fx: number | null): string | null {
  if (!finite(amountUsd)) return null;
  return money(amountUsd, currency, fx);
}

export function buildLoanDetail(input: {
  loanId: string;
  currency: "USD" | "ZAR";
  targetLtv: number;
  fx: number | null;
  asOf: string | null;
  snapshotStatus: "pending" | "error" | "missing" | "unreadable" | "ready";
  loansIncluded: boolean;
  snapshotLoan: SnapshotLoanSource | null;
  liveStatus: "pending" | "error" | "ready";
  liveLoan: LiveLoanSource | null;
  accountLabel: string | null;
  repayments: SectionGate;
  events: LoanEvent[];
  luno: SectionGate;
  lunoTransactions: LunoTransaction[];
  container: LunoContainerLinks | null;
  containerName: string | null;
}): LoanDetailResult {
  const snapshotLoan = input.snapshotStatus === "ready" ? readableSnapshotLoan(input.snapshotLoan) : null;
  const liveLoan = input.liveStatus === "ready" ? input.liveLoan : null;
  const resolved = resolveLoan(snapshotLoan, liveLoan);

  if (!resolved) {
    if (input.snapshotStatus === "pending" || (input.snapshotStatus === "ready" && input.liveStatus === "pending" && !snapshotLoan)) {
      return { kind: "loading", message: LOAN_LOADING };
    }
    if (input.snapshotStatus === "error" && input.liveStatus !== "ready") {
      return { kind: "error", message: LOAN_SNAPSHOT_ERROR };
    }
    if (input.snapshotStatus === "missing" && input.liveStatus !== "ready") {
      return { kind: "missing", message: LOAN_SNAPSHOT_MISSING };
    }
    if (input.snapshotStatus === "unreadable" && input.liveStatus !== "ready") {
      return { kind: "error", message: LOAN_SNAPSHOT_UNREADABLE };
    }
    if (input.snapshotStatus === "ready" && !input.loansIncluded && input.liveStatus !== "ready") {
      return { kind: "missing", message: LOANS_ABSENT };
    }
    if (input.snapshotStatus === "ready" && input.snapshotLoan && !snapshotLoan && input.liveStatus !== "ready") {
      return { kind: "error", message: LOAN_UNREADABLE };
    }
    if (input.liveStatus === "pending") return { kind: "loading", message: LOAN_LOADING };
    return { kind: "missing", message: LOAN_MISSING };
  }

  const currency = input.currency;
  const fx = input.fx;
  const targetLtv = input.targetLtv > 0 ? input.targetLtv : 65;
  const status = statusFromLtv(resolved.ltv, targetLtv);
  const risk: RiskLoan = {
    id: input.loanId,
    debtUsd: resolved.debtUsd,
    ltv: resolved.ltv,
    collateral: {
      asset: resolved.collateralAsset,
      qty: resolved.collateralQty ?? 0,
      valueUsd: resolved.collateralValueUsd,
    },
  };
  const headroom = headroomToTarget(risk, targetLtv);
  const headroomAmount = money(Math.abs(headroom), currency, fx);
  const headroomText =
    headroom < 0
      ? `Over ${targetLtv}% by ${headroomAmount}`
      : headroom > 0
        ? `Headroom to ${targetLtv}%: ${headroomAmount}`
        : `At ${targetLtv}%`;
  const interest = interestFor(resolved);
  const prices = pricePair(resolved, currency, fx);
  let priceNote = prices.note;
  if (prices.warning == null) {
    if (input.liveStatus === "pending") priceNote = PRICE_TRIGGER_CHECKING;
    else if (input.liveStatus === "error") priceNote = PRICE_TRIGGER_LIVE_ERROR;
    else priceNote = PRICE_TRIGGER_UNAVAILABLE;
  }

  const events = input.repayments.status === "ready" ? input.events : [];
  const repayments = events.filter((event) => event.type === "repay" && finite(event.amount));
  const borrowAsset =
    events.find((event) => event.type === "borrow")?.asset ||
    repayments[0]?.asset ||
    resolved.asset;
  const scopedLuno =
    input.luno.status === "ready"
      ? filterLunoTxsForContainer(input.lunoTransactions, input.container)
      : [];
  const funding = lunoFundingForAsset(scopedLuno, borrowAsset);
  const matches = matchRepaymentsToBuys(
    repayments.map((event) => ({ ts: event.ts, amount: Math.abs(event.amount) })),
    funding.buys,
  );

  const repaymentRows: RepaymentRow[] | null =
    input.repayments.status === "ready"
      ? repayments.map((event, index) => {
          const buy = matches[index];
          return {
            amount: `+${fmtQty(Math.abs(event.amount), event.asset)}`,
            when: fmtDate(event.ts),
            funding: buy
              ? `Luno buy R${groupWithSpaces(buy.rate, 2)}/${event.asset} · spent R${groupWithSpaces(buy.zarSpent, 2)}`
              : null,
            value: eventValue(event.amountUsd, currency, fx),
          };
        })
      : null;

  const lunoReady = input.luno.status === "ready";
  const lunoBuys: FundingRow[] | null = lunoReady
    ? funding.buys.map((buy) => ({
        kind: "buy",
        amount: `+${fmtQty(buy.assetQty, displaySymbol(borrowAsset))}`,
        detail: `R${groupWithSpaces(buy.rate, 2)}/${displaySymbol(borrowAsset)} · ${buy.accountName} · ${fmtDate(buy.ts)}`,
        value: `R${groupWithSpaces(buy.zarSpent, 2)}`,
      }))
    : null;
  const lunoMoves: FundingRow[] | null = lunoReady
    ? funding.moves.map((move) => ({
        kind: "move",
        amount: `−${fmtQty(move.assetQty, displaySymbol(borrowAsset))}`,
        detail: `${move.description ? `${move.description} · ` : ""}${move.accountName} · ${fmtDate(move.ts)}`,
        value: null,
      }))
    : null;

  const title = resolved.collateralAsset
    ? `${resolved.collateralAsset}/${resolved.asset}`
    : resolved.asset;

  return {
    kind: "loan",
    view: {
      title,
      accountLabel: input.accountLabel ?? "Account not in the synced list",
      asOfLabel: input.asOf ? fmtDate(input.asOf) : null,
      ltv: fmtPct(resolved.ltv, 1),
      status,
      statusText: statusLabel(status),
      position: [
        {
          label: "Borrowed",
          value: resolved.debtQty != null
            ? `${fmtQty(resolved.debtQty, resolved.asset)} · ${money(resolved.debtUsd, currency, fx)}`
            : `${money(resolved.debtUsd, currency, fx)}. ${BORROWED_QTY_UNAVAILABLE}`,
        },
        {
          label: "Collateral",
          value: resolved.collateralQty != null
            ? fmtQty(resolved.collateralQty, resolved.collateralAsset || "collateral")
            : COLLATERAL_QTY_UNAVAILABLE,
        },
        {
          label: "Collateral value",
          value: money(resolved.collateralValueUsd, currency, fx),
        },
        { label: headroom >= 0 ? "Headroom to target" : "Over target by", value: headroomText },
      ],
      priceNote,
      warningPrice: prices.warning == null ? null : `Warning (${WARNING_LTV}%): ${prices.warning}`,
      liquidationPrice:
        prices.liquidation == null ? null : `Liquidation (${LIQ_LTV}%): ${prices.liquidation}`,
      apr: resolved.apr == null ? null : fmtPct(resolved.apr, 2),
      hourlyRate: interest.available ? fmtPct(interest.hourlyRate * 100, 5) : null,
      hourlyInterest: interest.available ? money(interest.hourlyUsd, currency, fx) : null,
      dailyInterest: interest.available ? money(interest.dailyUsd, currency, fx) : null,
      interestNote: interest.available
        ? interest.source === "apr"
          ? INTEREST_FROM_APR
          : INTEREST_FROM_HOURLY
        : INTEREST_UNAVAILABLE,
      debtGrowth: interest.available
        ? [
            { label: "Today", value: money(resolved.debtUsd, currency, fx) },
            { label: "In 30 days", value: money(resolved.debtUsd + interest.dailyUsd * 30, currency, fx) },
            { label: "In 90 days", value: money(resolved.debtUsd + interest.dailyUsd * 90, currency, fx) },
            { label: "In 365 days", value: money(resolved.debtUsd + interest.dailyUsd * 365, currency, fx) },
          ]
        : null,
      debtGrowthNote: interest.available ? DEBT_GROWTH_NOTE : null,
      currentPrice: prices.currentPrice,
      currentPriceNote: prices.currentPriceNote,
      falls: simCells(resolved.ltv, targetLtv, -1),
      rises: simCells(resolved.ltv, targetLtv, 1),
      repaymentsNote:
        repaymentGateMessage(input.repayments) ??
        (repayments.length === 0 ? REPAYMENTS_EMPTY : null),
      repayments: repaymentRows,
      lunoNote:
        !lunoReady || (funding.buys.length === 0 && funding.moves.length === 0)
          ? lunoGateMessage(input.luno, displaySymbol(borrowAsset))
          : null,
      lunoBuys,
      lunoMoves,
      lunoScope:
        lunoReady && funding.buys.length + funding.moves.length > 0 && input.containerName
          ? `Showing ${input.containerName} activity only.`
          : null,
      debtQty: resolved.debtQty,
      debtUsd: resolved.debtUsd,
      rateDecimal: interest.available ? interest.hourlyRate : null,
    },
  };
}

function displaySymbol(asset: string): string {
  return asset.toUpperCase() === "XBT" ? "BTC" : asset.toUpperCase();
}

export function liveLoanFromApi(loan: {
  accountId: string;
  asset: string;
  debt: number;
  debtUsd: number;
  collateral: { asset: string; qty: number; valueUsd: number };
  ltv: number;
  apr: number;
  hourlyInterestRate: number;
} | null): LiveLoanSource | null {
  if (!loan) return null;
  return {
    accountId: loan.accountId,
    asset: loan.asset,
    collateralAsset: loan.collateral.asset,
    debtQty: positive(loan.debt),
    debtUsd: positive(loan.debtUsd),
    collateralQty: positive(loan.collateral.qty),
    collateralValueUsd: positive(loan.collateral.valueUsd),
    ltv: finite(loan.ltv) && loan.ltv >= 0 ? loan.ltv : null,
    apr: finite(loan.apr) ? loan.apr : null,
    hourlyInterestRate: positive(loan.hourlyInterestRate),
  };
}

export function sumBorrowedQuantity(events: LoanEvent[]): number | null {
  const borrows = events.filter((event) => event.type === "borrow" && finite(event.amount) && event.amount > 0);
  if (borrows.length === 0) return null;
  return borrows.reduce((sum, event) => sum + event.amount, 0);
}

export function targetLtvForContainer(settings: unknown, containerId: string | null): number {
  if (typeof settings !== "object" || settings === null) return 65;
  const record = settings as Record<string, unknown>;
  const overrides = record.targetOverrides;
  if (containerId && typeof overrides === "object" && overrides !== null) {
    const value = (overrides as Record<string, unknown>)[containerId];
    if (typeof value === "number" && value > 0 && value < 100) return value;
  }
  const target = record.targetLtv;
  if (typeof target === "number" && target > 0 && target < 100) return target;
  return 65;
}
