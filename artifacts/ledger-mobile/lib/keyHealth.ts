import type { BinanceAccount } from "@/lib/binanceKeys";
import { toBase64 } from "@/lib/encoding";

export type ProbeResult =
  | { status: "ok"; checkedAt: number }
  | { status: "fail"; checkedAt: number; reason: string };

/**
 * Single-account health probe. Calls /api/accounts with only this account's
 * credentials in the X-Binance-Accounts header so we can tell which key is
 * broken (the multiplexed dashboard call swallows per-account failures into
 * an empty list, which is the wrong signal for settings).
 */
export async function probeAccount(
  account: BinanceAccount,
  baseUrl: string,
  token: string | null,
): Promise<ProbeResult> {
  const payload = [
    {
      id: account.id,
      name: account.name,
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
    },
  ];
  const header = toBase64(JSON.stringify(payload));
  const url = `${baseUrl.replace(/\/$/, "")}/api/accounts`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Binance-Accounts": header,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body.error === "string") reason = body.error;
      } catch {
        // ignore body parse errors
      }
      return { status: "fail", checkedAt: Date.now(), reason };
    }
    const data = (await res.json()) as { accounts?: unknown[] };
    if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
      return {
        status: "fail",
        checkedAt: Date.now(),
        reason: "No account returned — key may be invalid",
      };
    }
    return { status: "ok", checkedAt: Date.now() };
  } catch (err) {
    return {
      status: "fail",
      checkedAt: Date.now(),
      reason: err instanceof Error ? err.message : "Network error",
    };
  }
}
