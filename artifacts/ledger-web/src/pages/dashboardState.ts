import { fmtDateTime, fmtDisplayMoney, fmtPct, fmtUsd, groupWithSpaces } from "@/domain/format";
import {
  DEFAULT_TARGET_LTV,
  headroomToTarget,
  statusFromLtv,
  statusLabel,
  type RiskLoan,
  type Status,
} from "@/domain/risk";

export const DASHBOARD_EMPTY_PORTFOLIO =
  "No signed-in session. Exchange loans, holdings, and prices stay empty until sign-in. API keys stay on the server.";

export const DASHBOARD_LOADING = "Loading the saved snapshot…";

export const DASHBOARD_MISSING_SNAPSHOT =
  "No LTV snapshot is stored for this session. Loans, balances, and prices are not shown.";

export const DASHBOARD_SNAPSHOT_UNREADABLE =
  "The stored snapshot could not be read. Loans, balances, and prices are not shown.";

export const DASHBOARD_SNAPSHOT_ERROR =
  "The snapshot could not be loaded. Loans, balances, and prices are not shown.";

export const DASHBOARD_RATE_UNAVAILABLE = "Exchange rate is not in this snapshot";

export const DASHBOARD_PRICE_NOTE = "Price drop until liquidation is not in this snapshot.";

/** Label for the public liveness check. This is not a balance or a price. */
export function healthStatusLabel(input: {
  pending: boolean;
  failed: boolean;
  status?: unknown;
}): string {
  if (input.pending) return "Checking the API…";
  if (input.failed) return "Unreachable";
  if (typeof input.status !== "string") return "Unreachable";
  const status = input.status.trim();
  return status.length > 0 ? status : "Unreachable";
}

export type SnapshotLoanInput = {
  id: string;
  accountId: string;
  asset: string;
  debtUsd: number;
  collateralAsset: string;
  collateralValueUsd: number;
  ltv: number;
  apr: number;
};

export type SnapshotContainerInput = {
  containerId: string;
  name?: string;
  type?: string;
  debtUsd: number;
  collateralUsd: number;
  ltv: number;
  loanCount: number;
};

export type SnapshotInput = {
  updatedAt: string;
  asOf: string;
  aggregateLtv: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  loans?: SnapshotLoanInput[];
  holdingsUsd?: number;
  interestLifetimeUsd?: number;
  interestProjected30dUsd?: number;
  perContainer?: SnapshotContainerInput[];
  fxUsdToZar?: number;
};

export type DashboardLoanRow = {
  id: string;
  title: string;
  accountLabel: string;
  ltv: string;
  status: Status;
  statusText: string;
  debt: string;
  collateral: string;
  apr: string;
  headroom: string;
};

export type DashboardContainerRow = {
  id: string;
  name: string;
  ltv: string;
  debt: string;
  collateral: string;
  loanCount: string;
};

export type DashboardSnapshotView = {
  asOfLabel: string;
  aggregateLtv: string;
  debt: string;
  collateral: string;
  holdings: string | null;
  interestLifetime: string | null;
  interestProjected30d: string | null;
  fxLabel: string | null;
  zarAvailable: boolean;
  containers: DashboardContainerRow[];
  containersNote: string | null;
  loans: DashboardLoanRow[];
  loansNote: string | null;
  closest: { id: string; title: string; ltv: string; accountLabel: string } | null;
  priceNote: string | null;
};

export type DashboardPaint =
  | { kind: "signed-out"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "unreadable"; message: string }
  | { kind: "snapshot"; view: DashboardSnapshotView };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fxRate(snapshot: SnapshotInput): number | null {
  return finite(snapshot.fxUsdToZar) && snapshot.fxUsdToZar > 0 ? snapshot.fxUsdToZar : null;
}

export function snapshotMoney(
  usd: number,
  currency: "USD" | "ZAR",
  fx: number | null,
): string {
  if (!finite(usd)) return "—";
  if (currency === "USD") return fmtUsd(usd, { whole: true });
  if (fx == null) return DASHBOARD_RATE_UNAVAILABLE;
  return fmtDisplayMoney(usd * fx, "ZAR", { whole: true });
}

function optionalMoney(
  value: number | undefined,
  currency: "USD" | "ZAR",
  fx: number | null,
): string | null {
  if (!finite(value)) return null;
  return snapshotMoney(value, currency, fx);
}

function containerName(row: SnapshotContainerInput): string {
  const name = row.name?.trim();
  if (name) return name;
  if (row.type === "personal") return "Personal";
  if (row.type === "trust") return "Trust";
  return "Unnamed profile";
}

function loanTitle(loan: SnapshotLoanInput): string {
  const asset = loan.asset.trim() || "Loan";
  const collateral = loan.collateralAsset.trim();
  return collateral ? `${asset} · ${collateral}` : asset;
}

export function dashboardPaint(input: {
  signedIn: boolean;
  pending: boolean;
  failed: boolean;
  envelope?: { available?: boolean; snapshot?: SnapshotInput | null } | null;
  currency: "USD" | "ZAR";
  accountLabels?: ReadonlyMap<string, string>;
}): DashboardPaint {
  if (!input.signedIn) return { kind: "signed-out", message: DASHBOARD_EMPTY_PORTFOLIO };
  if (input.pending) return { kind: "loading", message: DASHBOARD_LOADING };
  if (input.failed) return { kind: "error", message: DASHBOARD_SNAPSHOT_ERROR };
  const envelope = input.envelope;
  if (!envelope || envelope.available !== true || !envelope.snapshot) {
    return { kind: "missing", message: DASHBOARD_MISSING_SNAPSHOT };
  }
  const snapshot = envelope.snapshot;
  if (
    !finite(snapshot.aggregateLtv) ||
    !finite(snapshot.totalDebtUsd) ||
    !finite(snapshot.totalCollateralUsd)
  ) {
    return { kind: "unreadable", message: DASHBOARD_SNAPSHOT_UNREADABLE };
  }

  const fx = fxRate(snapshot);
  const currency = input.currency;
  const labels = input.accountLabels;
  const loans = (snapshot.loans ?? []).flatMap((loan) => {
    if (
      !finite(loan.debtUsd) ||
      !finite(loan.collateralValueUsd) ||
      !finite(loan.ltv) ||
      !finite(loan.apr) ||
      typeof loan.id !== "string" ||
      loan.id.length === 0
    ) {
      return [];
    }
    const risk: RiskLoan = {
      id: loan.id,
      debtUsd: loan.debtUsd,
      ltv: loan.ltv,
      collateral: {
        asset: loan.collateralAsset,
        qty: 0,
        valueUsd: loan.collateralValueUsd,
      },
    };
    const status = statusFromLtv(loan.ltv);
    const headroom = headroomToTarget(risk);
    const headroomAmount = snapshotMoney(Math.abs(headroom), currency, fx);
    const headroomText =
      headroom < 0
        ? `Over ${DEFAULT_TARGET_LTV}% by ${headroomAmount}`
        : headroom > 0
          ? `Headroom to ${DEFAULT_TARGET_LTV}%: ${headroomAmount}`
          : `At ${DEFAULT_TARGET_LTV}%`;
    const accountLabel = labels?.get(loan.accountId) ?? "Account not in the synced list";
    return [
      {
        id: loan.id,
        title: loanTitle(loan),
        accountLabel,
        ltv: fmtPct(loan.ltv),
        status,
        statusText: statusLabel(status),
        debt: snapshotMoney(loan.debtUsd, currency, fx),
        collateral: snapshotMoney(loan.collateralValueUsd, currency, fx),
        apr: fmtPct(loan.apr),
        headroom: headroomText,
      },
    ];
  });

  const closestLoan = [...loans].sort((a, b) => {
    const left = snapshot.loans?.find((loan) => loan.id === a.id)?.ltv ?? 0;
    const right = snapshot.loans?.find((loan) => loan.id === b.id)?.ltv ?? 0;
    return right - left;
  })[0];

  const containers = (snapshot.perContainer ?? []).flatMap((row) => {
    if (!finite(row.ltv) || !finite(row.debtUsd) || !finite(row.collateralUsd) || !finite(row.loanCount)) {
      return [];
    }
    return [
      {
        id: row.containerId,
        name: containerName(row),
        ltv: fmtPct(row.ltv),
        debt: snapshotMoney(row.debtUsd, currency, fx),
        collateral: snapshotMoney(row.collateralUsd, currency, fx),
        loanCount: String(row.loanCount),
      },
    ];
  });

  return {
    kind: "snapshot",
    view: {
      asOfLabel: fmtDateTime(snapshot.asOf),
      aggregateLtv: fmtPct(snapshot.aggregateLtv),
      debt: snapshotMoney(snapshot.totalDebtUsd, currency, fx),
      collateral: snapshotMoney(snapshot.totalCollateralUsd, currency, fx),
      holdings: optionalMoney(snapshot.holdingsUsd, currency, fx),
      interestLifetime: optionalMoney(snapshot.interestLifetimeUsd, currency, fx),
      interestProjected30d: optionalMoney(snapshot.interestProjected30dUsd, currency, fx),
      fxLabel: fx == null ? null : `R${groupWithSpaces(fx, 2)} per USD`,
      zarAvailable: fx != null,
      containers,
      containersNote:
        snapshot.perContainer == null
          ? "Per-account LTV is not included in this snapshot."
          : snapshot.perContainer.length === 0
            ? "No profiles are included in this snapshot."
            : null,
      loans,
      loansNote:
        snapshot.loans == null
          ? "Loans are not included in this snapshot."
          : snapshot.loans.length === 0
            ? "No open loans in this snapshot."
            : loans.length === 0
              ? "Loans in this snapshot could not be read."
              : null,
      closest: closestLoan
        ? {
            id: closestLoan.id,
            title: closestLoan.title,
            ltv: closestLoan.ltv,
            accountLabel: closestLoan.accountLabel,
          }
        : null,
      priceNote: loans.length > 0 ? DASHBOARD_PRICE_NOTE : null,
    },
  };
}
