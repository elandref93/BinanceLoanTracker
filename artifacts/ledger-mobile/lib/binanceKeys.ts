// Thin compat shim over the new container-based accountStore. Existing call
// sites (settings, dashboard, key-health probes, X-Binance-Accounts builder)
// keep working unchanged — each "account" they see is a binance link
// flattened out of its container.
//
// New code should import from `@/lib/accountStore` directly.

import {
  getBinanceLinks,
  removeLink,
  listContainersWithSecrets,
  useStoredAccountsCount as useContainerCount,
} from "@/lib/accountStore";

export type BinanceAccount = {
  /** link id (per-link, NOT container id). */
  id: string;
  /** Display name — container.name (· link.label if present). */
  name: string;
  apiKey: string;
  apiSecret: string;
  createdAt: string;
  /** id of the container this link belongs to. */
  containerId: string;
};

export type StoredBinanceAccount = Omit<BinanceAccount, "apiSecret"> & {
  apiKeyMasked: string;
};

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function listAccountsWithSecrets(): Promise<BinanceAccount[]> {
  const links = await getBinanceLinks();
  const containers = await listContainersWithSecrets();
  return links.map((l) => {
    const c = containers.find((x) => x.id === l.containerId);
    const link = c?.links.find((y) => y.id === l.id);
    return {
      id: l.id,
      name: l.name,
      apiKey: l.apiKey,
      apiSecret: l.apiSecret,
      createdAt: link?.createdAt ?? new Date().toISOString(),
      containerId: l.containerId,
    };
  });
}

export async function listAccounts(): Promise<StoredBinanceAccount[]> {
  const accounts = await listAccountsWithSecrets();
  return accounts.map(({ apiSecret: _s, ...rest }) => ({
    ...rest,
    apiKeyMasked: maskKey(rest.apiKey),
  }));
}

/**
 * Removes the binance link with this id. If the parent container is left with
 * zero links the container itself is preserved (user can add another link
 * later). Use `removeContainer` from accountStore to nuke the whole container.
 */
export async function removeAccount(linkId: string): Promise<void> {
  const accounts = await listAccountsWithSecrets();
  const acc = accounts.find((a) => a.id === linkId);
  if (!acc) return;
  await removeLink(acc.containerId, linkId);
}

export const useStoredAccountsCount = useContainerCount;

export function validateBinanceKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return "API key is required";
  if (trimmed.length < 16) return "API key looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed))
    return "API key must be letters and numbers only";
  return null;
}

export function validateBinanceSecret(apiSecret: string): string | null {
  const trimmed = apiSecret.trim();
  if (!trimmed) return "API secret is required";
  if (trimmed.length < 16) return "API secret looks too short";
  if (!/^[A-Za-z0-9]+$/.test(trimmed))
    return "API secret must be letters and numbers only";
  return null;
}
