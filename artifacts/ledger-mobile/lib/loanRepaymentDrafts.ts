import type { LoanAnnotation } from "@/lib/loanAnnotations";

export type RepaymentFieldDrafts = {
  borrowedValueZar: string;
  sellRate: string;
  targetRepaymentUsdcZarRate: string;
};

export function parseOptionalDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function draftsFromAnnotation(
  annotation: LoanAnnotation,
): RepaymentFieldDrafts {
  return {
    borrowedValueZar:
      annotation.borrowedValueZar != null
        ? String(annotation.borrowedValueZar)
        : "",
    sellRate: annotation.sellRate != null ? String(annotation.sellRate) : "",
    targetRepaymentUsdcZarRate:
      annotation.targetRepaymentUsdcZarRate != null
        ? String(annotation.targetRepaymentUsdcZarRate)
        : "",
  };
}

/**
 * Build the per-loan annotation patch for repayment-rate fields. Explicit
 * sellRate wins; otherwise derive from borrowed ZAR ÷ borrowed quantity.
 */
export function buildRepaymentAnnotationPatch(
  drafts: RepaymentFieldDrafts,
  totalBorrowedQty: number,
  planPrincipal: number,
): Partial<
  Record<keyof LoanAnnotation, LoanAnnotation[keyof LoanAnnotation] | null>
> {
  const borrowedValueZar = parseOptionalDecimal(drafts.borrowedValueZar);
  const explicitSell = parseOptionalDecimal(drafts.sellRate);
  const derivedSell =
    borrowedValueZar != null && borrowedValueZar > 0 && totalBorrowedQty > 0
      ? borrowedValueZar / totalBorrowedQty
      : borrowedValueZar != null && borrowedValueZar > 0 && planPrincipal > 0
        ? borrowedValueZar / planPrincipal
        : null;

  return {
    borrowedValueZar,
    sellRate: explicitSell ?? derivedSell,
    targetRepaymentUsdcZarRate: parseOptionalDecimal(
      drafts.targetRepaymentUsdcZarRate,
    ),
  };
}
