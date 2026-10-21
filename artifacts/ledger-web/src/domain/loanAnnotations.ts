import { parseDecimalInput } from "@/domain/decimalInput";

/**
 * Per-loan notes already stored by the annotation sync blob.
 * The payload is an opaque map keyed by loan id. Web writes omit `updatedAt`
 * so the server assigns the clock. Unknown keys on a loan are kept so a phone
 * write is not stripped, and they are never rendered.
 */

export type GoalMode = "contribution" | "target" | "collateral";

export const ANNOTATION_FIELDS = [
  "sellRate",
  "borrowedValueZar",
  "targetRepaymentUsdcZarRate",
  "monthlyContribution",
  "targetSettleDate",
  "monthlyCollateralContribution",
  "goalMode",
] as const;

export type AnnotationField = (typeof ANNOTATION_FIELDS)[number];

export type LoanAnnotation = Partial<{
  sellRate: number;
  borrowedValueZar: number;
  targetRepaymentUsdcZarRate: number;
  monthlyContribution: number;
  targetSettleDate: string;
  monthlyCollateralContribution: number;
  goalMode: GoalMode;
}>;

export type AnnotationDrafts = {
  borrowedValueZar: string;
  sellRate: string;
  targetRepaymentUsdcZarRate: string;
  monthlyContribution: string;
  targetSettleDate: string;
  monthlyCollateralContribution: string;
  goalMode: GoalMode;
};

export type AnnotationMap = Record<string, Record<string, unknown>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function goalMode(value: unknown): GoalMode | undefined {
  if (value === "contribution" || value === "target" || value === "collateral") return value;
  return undefined;
}

export function readAnnotationMap(raw: unknown): AnnotationMap {
  if (!isRecord(raw)) return {};
  const map: AnnotationMap = {};
  for (const [loanId, value] of Object.entries(raw)) {
    if (loanId.length === 0 || !isRecord(value)) continue;
    map[loanId] = { ...value };
  }
  return map;
}

export function annotationFor(map: AnnotationMap, loanId: string): LoanAnnotation {
  const raw = map[loanId];
  if (!raw) return {};
  const date = typeof raw.targetSettleDate === "string" && DATE_RE.test(raw.targetSettleDate)
    ? raw.targetSettleDate
    : undefined;
  const mode = goalMode(raw.goalMode);
  return {
    ...(finiteNumber(raw.sellRate) != null ? { sellRate: finiteNumber(raw.sellRate) } : {}),
    ...(finiteNumber(raw.borrowedValueZar) != null
      ? { borrowedValueZar: finiteNumber(raw.borrowedValueZar) }
      : {}),
    ...(finiteNumber(raw.targetRepaymentUsdcZarRate) != null
      ? { targetRepaymentUsdcZarRate: finiteNumber(raw.targetRepaymentUsdcZarRate) }
      : {}),
    ...(finiteNumber(raw.monthlyContribution) != null
      ? { monthlyContribution: finiteNumber(raw.monthlyContribution) }
      : {}),
    ...(finiteNumber(raw.monthlyCollateralContribution) != null
      ? { monthlyCollateralContribution: finiteNumber(raw.monthlyCollateralContribution) }
      : {}),
    ...(date != null ? { targetSettleDate: date } : {}),
    ...(mode != null ? { goalMode: mode } : {}),
  };
}

function numberText(value: number | undefined): string {
  return value == null ? "" : String(value);
}

export function draftsFromAnnotation(annotation: LoanAnnotation): AnnotationDrafts {
  return {
    borrowedValueZar: numberText(annotation.borrowedValueZar),
    sellRate: numberText(annotation.sellRate),
    targetRepaymentUsdcZarRate: numberText(annotation.targetRepaymentUsdcZarRate),
    monthlyContribution: numberText(annotation.monthlyContribution),
    targetSettleDate: annotation.targetSettleDate ?? "",
    monthlyCollateralContribution: numberText(annotation.monthlyCollateralContribution),
    goalMode: annotation.goalMode ?? "contribution",
  };
}

export type DraftParse =
  | { ok: true; annotation: LoanAnnotation }
  | { ok: false; message: string };

function optionalAmount(raw: string, label: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = parseDecimalInput(trimmed);
  if (value == null) return { ok: false, message: `${label} needs a number. Use a comma or a dot for the decimal.` };
  if (value < 0) return { ok: false, message: `${label} cannot be negative.` };
  return { ok: true, value };
}

/**
 * Explicit sell rate wins. Otherwise derive ZAR per borrowed unit from the
 * borrowed ZAR value and a quantity the exchange actually returned.
 */
export function parseAnnotationDrafts(
  drafts: AnnotationDrafts,
  quantities: { totalBorrowedQty: number | null; planPrincipal: number | null },
): DraftParse {
  const borrowed = optionalAmount(drafts.borrowedValueZar, "Borrowed asset value");
  if (!borrowed.ok) return borrowed;
  const sell = optionalAmount(drafts.sellRate, "Conversion rate");
  if (!sell.ok) return sell;
  const target = optionalAmount(drafts.targetRepaymentUsdcZarRate, "Target repayment rate");
  if (!target.ok) return target;
  const monthly = optionalAmount(drafts.monthlyContribution, "Monthly contribution");
  if (!monthly.ok) return monthly;
  const collateral = optionalAmount(drafts.monthlyCollateralContribution, "Monthly collateral amount");
  if (!collateral.ok) return collateral;

  const date = drafts.targetSettleDate.trim();
  if (date !== "" && !DATE_RE.test(date)) {
    return { ok: false, message: "Settlement date must be a calendar date." };
  }
  const mode = goalMode(drafts.goalMode);
  if (!mode) return { ok: false, message: "Choose a repayment goal." };

  const borrowedQty = quantities.totalBorrowedQty;
  const principal = quantities.planPrincipal;
  const derivedSell =
    borrowed.value != null && borrowed.value > 0 && borrowedQty != null && borrowedQty > 0
      ? borrowed.value / borrowedQty
      : borrowed.value != null && borrowed.value > 0 && principal != null && principal > 0
        ? borrowed.value / principal
        : null;

  const annotation: LoanAnnotation = { goalMode: mode };
  if (borrowed.value != null) annotation.borrowedValueZar = borrowed.value;
  const sellRate = sell.value ?? derivedSell;
  if (sellRate != null) annotation.sellRate = sellRate;
  if (target.value != null) annotation.targetRepaymentUsdcZarRate = target.value;
  if (monthly.value != null) annotation.monthlyContribution = monthly.value;
  if (collateral.value != null) annotation.monthlyCollateralContribution = collateral.value;
  if (date !== "") annotation.targetSettleDate = date;
  return { ok: true, annotation };
}

function sameAnnotation(left: LoanAnnotation, right: LoanAnnotation): boolean {
  const normalize = (annotation: LoanAnnotation): LoanAnnotation => ({
    ...annotation,
    goalMode: annotation.goalMode ?? "contribution",
  });
  const a = normalize(left);
  const b = normalize(right);
  return ANNOTATION_FIELDS.every((field) => a[field] === b[field]);
}

export function annotationsEqual(stored: LoanAnnotation, drafts: AnnotationDrafts, quantities: {
  totalBorrowedQty: number | null;
  planPrincipal: number | null;
}): boolean {
  const parsed = parseAnnotationDrafts(drafts, quantities);
  if (!parsed.ok) return false;
  return sameAnnotation(stored, parsed.annotation);
}

/**
 * Replace one loan's known fields and keep every other loan, plus unknown
 * keys on this loan. Returns null when the drafts are not valid.
 */
export function writeLoanAnnotation(
  map: AnnotationMap,
  loanId: string,
  drafts: AnnotationDrafts,
  quantities: { totalBorrowedQty: number | null; planPrincipal: number | null },
): { ok: true; map: AnnotationMap } | { ok: false; message: string } {
  const parsed = parseAnnotationDrafts(drafts, quantities);
  if (!parsed.ok) return parsed;
  const current = { ...(map[loanId] ?? {}) };
  for (const field of ANNOTATION_FIELDS) {
    const value = parsed.annotation[field];
    if (value == null) delete current[field];
    else current[field] = value;
  }
  const next: AnnotationMap = { ...map };
  if (Object.keys(current).length === 0) delete next[loanId];
  else next[loanId] = current;
  return { ok: true, map: next };
}
