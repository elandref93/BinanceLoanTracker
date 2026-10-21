import type { PlainAccount } from "../credentialStore";
import { lunoFetch, type LunoCredentials } from "../luno";
import type { SourceCursor } from "./ledgerStore";
import { normaliseAsset, type LedgerEvent, type LedgerEventType } from "./types";

const PAGE = 1000;

interface RawRow {
  row_index: number;
  timestamp: number;
  balance: number | string;
  balance_delta: number | string;
  available_delta?: number | string;
  currency: string;
  description?: string;
  kind?: string;
}

/**
 * Luno's own `kind` decides the type; the description is a fallback for
 * older rows without one. Transfers are money entering or leaving Luno.
 */
export function classifyLunoRow(kind: string | undefined, description: string, delta: number): { type: LedgerEventType; external: boolean } {
  const k = (kind ?? "").toUpperCase();
  const text = description.toLowerCase();
  if (k === "FEE" || (!k && /\bfee\b/.test(text))) return { type: "fee", external: false };
  if (k === "INTEREST" || (!k && /(interest|reward|staking|earn)/.test(text))) return { type: "income", external: false };
  if (k === "EXCHANGE" || (!k && /(bought|sold|exchange|trade|instant (buy|sell))/.test(text))) {
    return { type: delta >= 0 ? "buy" : "sell", external: false };
  }
  return { type: delta >= 0 ? "deposit" : "withdrawal", external: true };
}

function num(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Imports one Luno link forward from the last row per wallet. Luno returns
 * row ranges (min inclusive, max exclusive, up to 1000 rows), so a wallet's
 * entire history arrives in order and the running balance makes every day
 * exact.
 */
export async function importLunoLink(
  account: PlainAccount,
  cursor: SourceCursor,
  deadline: number,
  pause: () => Promise<void>,
): Promise<{ events: LedgerEvent[]; cursor: SourceCursor }> {
  const creds: LunoCredentials = { keyId: account.apiKey, keySecret: account.apiSecret };
  const balance = await lunoFetch<{ balance?: Array<{ account_id: string; asset: string }> }>("/api/1/balance", creds);
  const wallets = balance.balance ?? [];
  const extra = { ...(cursor.extra ?? {}) };
  const events: LedgerEvent[] = [];
  let finished = true;
  let rows = cursor.rows;
  let oldest = cursor.coveredFrom;
  for (const wallet of wallets) {
    const asset = normaliseAsset(wallet.asset);
    let next = extra[wallet.account_id] ?? 1;
    for (;;) {
      if (Date.now() > deadline) {
        finished = false;
        break;
      }
      await pause();
      const res = await lunoFetch<{ transactions?: RawRow[] }>(
        `/api/1/accounts/${encodeURIComponent(wallet.account_id)}/transactions?min_row=${next}&max_row=${next + PAGE}`,
        creds,
      );
      const page = (res.transactions ?? []).sort((a, b) => a.row_index - b.row_index);
      for (const row of page) {
        const delta = num(row.balance_delta);
        if (delta === 0) continue;
        const description = row.description ?? "";
        const { type, external } = classifyLunoRow(row.kind, description, delta);
        events.push({
          id: `luno:${account.id}:${wallet.account_id}:${row.row_index}`,
          t: row.timestamp,
          exchange: "luno",
          linkId: account.id,
          type,
          asset,
          qty: delta,
          external: external || undefined,
          note: description.slice(0, 120),
        });
        if (oldest == null || row.timestamp < oldest) oldest = row.timestamp;
      }
      rows += page.length;
      if (page.length === 0) break;
      const last = page[page.length - 1] as RawRow;
      next = last.row_index + 1;
      extra[wallet.account_id] = next;
      if (page.length < PAGE) break;
    }
    if (!finished) break;
  }
  return {
    events,
    cursor: {
      ...cursor,
      rows,
      extra,
      coveredFrom: oldest,
      coveredTo: finished ? Date.now() : cursor.coveredTo,
      backfillDone: cursor.backfillDone || finished,
      state: finished ? "complete" : "running",
      error: null,
      updatedAt: Date.now(),
    },
  };
}
