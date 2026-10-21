import {
  getLoanAnnotationsSync,
  putLoanAnnotationsSync,
  type OpaqueObject,
} from "@workspace/api-client-react";

import { errorStatus } from "@/accounts/accountModel";
import {
  readAnnotationMap,
  writeLoanAnnotation,
  type AnnotationDrafts,
  type AnnotationMap,
} from "@/domain/loanAnnotations";

export const loanAnnotationsKey = ["loan-annotations"] as const;

export async function loadAnnotationMap(): Promise<AnnotationMap> {
  try {
    const record = await getLoanAnnotationsSync();
    return readAnnotationMap(record.annotations);
  } catch (error) {
    if (errorStatus(error) === 404) return {};
    throw error;
  }
}

export type AnnotationSaveResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; message: string };

export async function saveLoanAnnotation(
  loanId: string,
  drafts: AnnotationDrafts,
  quantities: { totalBorrowedQty: number | null; planPrincipal: number | null },
): Promise<AnnotationSaveResult> {
  const current = await loadAnnotationMap();
  const written = writeLoanAnnotation(current, loanId, drafts, quantities);
  if (!written.ok) return { ok: false, conflict: false, message: written.message };
  try {
    await putLoanAnnotationsSync({ annotations: written.map as OpaqueObject });
    return { ok: true };
  } catch (error) {
    if (errorStatus(error) === 409) return { ok: false, conflict: true };
    return { ok: false, conflict: false, message: "Could not save repayment notes." };
  }
}
