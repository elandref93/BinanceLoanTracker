/**
 * Personal/Trust profiles synced without exchange secrets.
 * Credentials are a separate payload for PUT /api/credentials/{exchange}/{id}.
 */

export type ExchangeKind = "binance" | "luno";
export type ProfileType = "personal" | "trust";

export type SyncLink = {
  id: string;
  exchange: ExchangeKind;
  label?: string;
  createdAt: string;
};

export type SyncContainer = {
  id: string;
  type: ProfileType;
  label?: string;
  name: string;
  createdAt: string;
  links: SyncLink[];
};

export type ContainerChoice =
  | { kind: "existing"; id: string }
  | { kind: "new"; type: ProfileType; label?: string };

export type CredentialPut = {
  exchange: ExchangeKind;
  id: string;
  name: string;
  apiKey: string;
  apiSecret: string;
};

export type AddLinkPlan = {
  containers: SyncContainer[];
  credential: CredentialPut;
};

export type CredentialDelete = {
  exchange: ExchangeKind;
  id: string;
};

export type RemovePlan = {
  containers: SyncContainer[];
  credentialDeletes: CredentialDelete[];
};

export class ProfileAlreadyHasLinkError extends Error {
  readonly exchange: ExchangeKind;
  constructor(exchange: ExchangeKind) {
    const which = exchange === "binance" ? "Binance" : "Luno";
    super(
      `This profile already has a ${which} link. Remove it first or pick a different profile.`,
    );
    this.name = "ProfileAlreadyHasLinkError";
    this.exchange = exchange;
  }
}

export class AccountSyncConflictError extends Error {
  constructor() {
    super("The account list was updated somewhere else. Reload this page and try again.");
    this.name = "AccountSyncConflictError";
  }
}

export class AccountSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountSaveError";
  }
}

export function titleCaseType(type: ProfileType): string {
  return type === "personal" ? "Personal" : "Trust";
}

export function deriveName(type: ProfileType, label?: string): string {
  const trimmed = label?.trim();
  return trimmed ? `${titleCaseType(type)} · ${trimmed}` : titleCaseType(type);
}

export function credentialDisplayName(profileName: string, linkLabel?: string): string {
  const full = linkLabel?.trim() ? `${profileName} · ${linkLabel.trim()}` : profileName;
  return full.slice(0, 128);
}

export function createContainerId(now = Date.now(), rand = Math.random().toString(36).slice(2, 8)): string {
  return `acct_${now}_${rand}`;
}

export function createLinkId(now = Date.now(), rand = Math.random().toString(36).slice(2, 8)): string {
  return `link_${now}_${rand}`;
}

function optionalLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLink(value: unknown): SyncLink | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 128) return null;
  if (record.exchange !== "binance" && record.exchange !== "luno") return null;
  if (typeof record.createdAt !== "string" || record.createdAt.length === 0) return null;
  const label = optionalLabel(record.label);
  return {
    id: record.id,
    exchange: record.exchange,
    createdAt: record.createdAt,
    ...(label ? { label } : {}),
  };
}

function parseContainer(value: unknown): SyncContainer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 128) return null;
  if (record.type !== "personal" && record.type !== "trust") return null;
  if (typeof record.createdAt !== "string" || record.createdAt.length === 0) return null;
  if (!Array.isArray(record.links)) return null;
  const label = optionalLabel(record.label);
  const links = record.links.flatMap((link) => {
    const parsed = parseLink(link);
    return parsed ? [parsed] : [];
  });
  return {
    id: record.id,
    type: record.type,
    createdAt: record.createdAt,
    name: deriveName(record.type, label),
    links,
    ...(label ? { label } : {}),
  };
}

/** Allowlist read. apiKey and apiSecret on a link are dropped. */
export function readSyncContainers(raw: unknown): SyncContainer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = parseContainer(item);
    return parsed ? [parsed] : [];
  });
}

/** JSON body for a web account-sync write. No updatedAt, and no credential fields. */
export function toAccountSyncBody(containers: SyncContainer[]): {
  containers: Array<Record<string, unknown>>;
} {
  return {
    containers: readSyncContainers(containers).map((container) => {
      const record: Record<string, unknown> = {
        id: container.id,
        type: container.type,
        name: container.name,
        createdAt: container.createdAt,
        links: container.links.map((link) => {
          const row: Record<string, unknown> = {
            id: link.id,
            exchange: link.exchange,
            createdAt: link.createdAt,
          };
          if (link.label) row.label = link.label;
          return row;
        }),
      };
      if (container.label) record.label = container.label;
      return record;
    }),
  };
}

export function soleOpenProfile(containers: SyncContainer[], exchange: ExchangeKind): string | null {
  if (containers.length !== 1) return null;
  const sole = containers[0];
  if (!sole || sole.links.some((link) => link.exchange === exchange)) return null;
  return sole.id;
}

export function accountLabelForLink(containers: SyncContainer[], linkId: string): string | null {
  for (const container of containers) {
    const link = container.links.find((item) => item.id === linkId);
    if (!link) continue;
    return link.label ? `${container.name} · ${link.label}` : container.name;
  }
  return null;
}

export function planAddLink(
  existing: SyncContainer[],
  target: ContainerChoice,
  link: { exchange: ExchangeKind; label?: string; apiKey: string; apiSecret: string },
  ids: { nowIso: string; containerId?: string; linkId: string },
): AddLinkPlan {
  const containers = readSyncContainers(existing);
  let container: SyncContainer | undefined;
  if (target.kind === "existing") {
    container = containers.find((item) => item.id === target.id);
    if (!container) throw new Error("Profile not found");
  } else {
    const label = target.label?.trim() || undefined;
    container = {
      id: ids.containerId ?? createContainerId(),
      type: target.type,
      createdAt: ids.nowIso,
      name: deriveName(target.type, label),
      links: [],
      ...(label ? { label } : {}),
    };
    containers.push(container);
  }
  if (container.links.some((item) => item.exchange === link.exchange)) {
    throw new ProfileAlreadyHasLinkError(link.exchange);
  }
  const linkLabel = link.label?.trim() || undefined;
  const syncLink: SyncLink = {
    id: ids.linkId,
    exchange: link.exchange,
    createdAt: ids.nowIso,
    ...(linkLabel ? { label: linkLabel } : {}),
  };
  container.links.push(syncLink);
  return {
    containers,
    credential: {
      exchange: link.exchange,
      id: ids.linkId,
      name: credentialDisplayName(container.name, linkLabel),
      apiKey: link.apiKey.trim(),
      apiSecret: link.apiSecret.trim(),
    },
  };
}

export function planRename(
  existing: SyncContainer[],
  containerId: string,
  label: string | null,
): SyncContainer[] {
  return readSyncContainers(existing).map((container) => {
    if (container.id !== containerId) return container;
    const nextLabel = label?.trim() || undefined;
    return {
      id: container.id,
      type: container.type,
      createdAt: container.createdAt,
      name: deriveName(container.type, nextLabel),
      links: container.links,
      ...(nextLabel ? { label: nextLabel } : {}),
    };
  });
}

export function planRemoveLink(
  existing: SyncContainer[],
  containerId: string,
  linkId: string,
): RemovePlan {
  const containers = readSyncContainers(existing);
  const deletes: CredentialDelete[] = [];
  const next = containers.map((container) => {
    if (container.id !== containerId) return container;
    const removed = container.links.find((link) => link.id === linkId);
    if (removed) deletes.push({ exchange: removed.exchange, id: removed.id });
    return {
      ...container,
      links: container.links.filter((link) => link.id !== linkId),
    };
  });
  return { containers: next, credentialDeletes: deletes };
}

export function planRemoveContainer(existing: SyncContainer[], containerId: string): RemovePlan {
  const containers = readSyncContainers(existing);
  const target = containers.find((container) => container.id === containerId);
  return {
    containers: containers.filter((container) => container.id !== containerId),
    credentialDeletes: target
      ? target.links.map((link) => ({ exchange: link.exchange, id: link.id }))
      : [],
  };
}

export type AccountWriteApi = {
  putCredentialLink: (
    exchange: ExchangeKind,
    id: string,
    body: { name: string; apiKey: string; apiSecret: string },
  ) => Promise<unknown>;
  deleteCredentialLink: (exchange: ExchangeKind, id: string) => Promise<unknown>;
  putAccountSync: (body: { containers: Array<Record<string, unknown>> }) => Promise<unknown>;
};

export function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" ? status : null;
}

function syncFailure(error: unknown): Error {
  if (errorStatus(error) === 409) return new AccountSyncConflictError();
  return error instanceof Error ? error : new Error("Could not save the account list");
}

export async function commitAddLink(api: AccountWriteApi, plan: AddLinkPlan): Promise<void> {
  await api.putCredentialLink(plan.credential.exchange, plan.credential.id, {
    name: plan.credential.name,
    apiKey: plan.credential.apiKey,
    apiSecret: plan.credential.apiSecret,
  });
  try {
    await api.putAccountSync(toAccountSyncBody(plan.containers));
  } catch (error) {
    try {
      await api.deleteCredentialLink(plan.credential.exchange, plan.credential.id);
    } catch {
      throw new AccountSaveError(
        "The account list could not be saved, and the server credential could not be removed. Remove it from Accounts before trying again.",
      );
    }
    const failure = syncFailure(error);
    if (failure instanceof AccountSyncConflictError) throw failure;
    throw new AccountSaveError("The account list could not be saved. The server credential was removed.");
  }
}

export async function commitRemove(api: AccountWriteApi, plan: RemovePlan): Promise<void> {
  for (const item of plan.credentialDeletes) {
    await api.deleteCredentialLink(item.exchange, item.id);
  }
  try {
    await api.putAccountSync(toAccountSyncBody(plan.containers));
  } catch (error) {
    throw syncFailure(error);
  }
}

export async function commitRename(api: AccountWriteApi, containers: SyncContainer[]): Promise<void> {
  try {
    await api.putAccountSync(toAccountSyncBody(containers));
  } catch (error) {
    throw syncFailure(error);
  }
}

export function safeClientMessage(error: unknown): string {
  if (
    error instanceof ProfileAlreadyHasLinkError ||
    error instanceof AccountSyncConflictError ||
    error instanceof AccountSaveError
  ) {
    return error.message;
  }
  const status = errorStatus(error);
  if (status === 503) return "The server cannot store keys yet. Nothing was saved in this browser.";
  if (status === 400) return "The server rejected the key. Check it and try again.";
  if (status === 401) return "The session ended. Sign in again. Nothing was saved in this browser.";
  if (status === 409) return new AccountSyncConflictError().message;
  return "Could not save the account. Nothing was saved in this browser.";
}
