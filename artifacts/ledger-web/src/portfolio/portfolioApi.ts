import { refreshPortfolio } from "@workspace/api-client-react";

function statusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") return error.status;
  return null;
}

/** Asks the server for a fresh snapshot. A 429 means one was taken in the last minute, which is fine. */
export async function requestLiveRefresh(): Promise<void> {
  try {
    await refreshPortfolio();
  } catch (error) {
    const status = statusOf(error);
    if (status === 429 || status === 503) return;
    throw error;
  }
}
