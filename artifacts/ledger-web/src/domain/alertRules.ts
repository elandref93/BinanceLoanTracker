/**
 * LTV alert rules stored in the settings sync blob, matching the phone.
 * The phone evaluates rules on the device and delivers them with a native
 * notification module. Web evaluates the same thresholds from loan LTV it
 * already has and does not deliver a notification.
 */

import { parseDecimalInput } from "@/domain/decimalInput";

export type AlertScope = "any" | { loanId: string } | { containerId: string };

export type AlertRule = {
  id: string;
  ltv: number;
  scope: AlertScope;
  label?: string;
};

export type AlertLoan = {
  id: string;
  accountId: string;
  ltv: number;
  asset: string;
  collateralAsset: string;
};

export type TriggerMatch = {
  ruleId: string;
  loanId: string;
  pair: string;
  ltv: number;
  threshold: number;
};

export type AlertLoanSource =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "ready"; source: "live" | "snapshot"; loans: AlertLoan[] };

export const ALERT_DELIVERY_UNAVAILABLE = "Alert delivery is not available on web.";

const MAX_ID_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) return null;
  return trimmed;
}

export function isLoanScope(scope: AlertScope): scope is { loanId: string } {
  return typeof scope === "object" && "loanId" in scope;
}

export function isContainerScope(scope: AlertScope): scope is { containerId: string } {
  return typeof scope === "object" && "containerId" in scope;
}

export function readScope(value: unknown): AlertScope | null {
  if (value === "any") return "any";
  if (!isRecord(value)) return null;
  const containerId = idText(value.containerId);
  if (containerId) return { containerId };
  const loanId = idText(value.loanId);
  if (loanId) return { loanId };
  return null;
}

export function readAlertRule(value: unknown): AlertRule | null {
  if (!isRecord(value)) return null;
  const id = idText(value.id);
  const scope = readScope(value.scope);
  if (!id || scope == null) return null;
  if (typeof value.ltv !== "number" || !Number.isFinite(value.ltv) || value.ltv <= 0 || value.ltv >= 100) {
    return null;
  }
  const label = typeof value.label === "string" && value.label.trim().length > 0 ? value.label.trim() : undefined;
  return { id, ltv: value.ltv, scope, ...(label ? { label } : {}) };
}

function rawRules(settings: unknown): unknown[] {
  if (!isRecord(settings) || !Array.isArray(settings.alertRules)) return [];
  return settings.alertRules;
}

export function rulesFromSettings(settings: unknown): AlertRule[] {
  const seen = new Set<string>();
  const rules: AlertRule[] = [];
  for (const item of rawRules(settings)) {
    const rule = readAlertRule(item);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    rules.push(rule);
  }
  rules.sort((left, right) => left.ltv - right.ltv || left.id.localeCompare(right.id));
  return rules;
}

function ltvSortKey(value: unknown): number | null {
  if (!isRecord(value) || typeof value.ltv !== "number" || !Number.isFinite(value.ltv)) return null;
  return value.ltv;
}

function sortStoredRules(rules: unknown[]): unknown[] {
  return rules
    .map((rule, index) => ({ rule, index, ltv: ltvSortKey(rule) }))
    .sort((left, right) => {
      if (left.ltv != null && right.ltv != null && left.ltv !== right.ltv) return left.ltv - right.ltv;
      if (left.ltv != null && right.ltv != null) return left.index - right.index;
      if (left.ltv != null) return -1;
      if (right.ltv != null) return 1;
      return left.index - right.index;
    })
    .map((item) => item.rule);
}

function cloneSettings(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {};
  return { ...settings };
}

export function roundAlertLtv(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Accepts a comma or dot decimal. The stored threshold is one decimal place, above 0 and below 100. */
export function parseLtvInput(raw: string): number | null {
  const value = parseDecimalInput(raw);
  if (value == null) return null;
  const rounded = roundAlertLtv(value);
  if (!(rounded > 0) || !(rounded < 100)) return null;
  return rounded;
}

export function makeRuleId(now = Date.now(), entropy = Math.random().toString(36).slice(2, 6)): string {
  return `r_${now.toString(36)}${entropy}`;
}

export function scopeKey(scope: AlertScope): string {
  if (scope === "any") return "any";
  if (isContainerScope(scope)) return `container:${scope.containerId}`;
  return `loan:${scope.loanId}`;
}

export function scopeFromKey(key: string): AlertScope {
  if (key === "any") return "any";
  if (key.startsWith("container:")) {
    const containerId = key.slice("container:".length);
    return containerId.length > 0 ? { containerId } : "any";
  }
  if (key.startsWith("loan:")) {
    const loanId = key.slice("loan:".length);
    return loanId.length > 0 ? { loanId } : "any";
  }
  return "any";
}

/**
 * Replace one rule and keep every other settings field, plus unknown keys on
 * the rule. The write omits a client `updatedAt`; the caller sends only this
 * object as `settings`.
 */
export function upsertStoredRule(settings: unknown, rule: AlertRule): Record<string, unknown> {
  const next = cloneSettings(settings);
  const kept = rawRules(settings).filter((item) => !(isRecord(item) && item.id === rule.id));
  const previous = rawRules(settings).find((item) => isRecord(item) && item.id === rule.id);
  const stored: Record<string, unknown> = {
    ...(isRecord(previous) ? previous : {}),
    id: rule.id,
    ltv: rule.ltv,
    scope: rule.scope,
  };
  if (rule.label) stored.label = rule.label;
  else delete stored.label;
  next.alertRules = sortStoredRules([...kept, stored]);
  return next;
}

export function deleteStoredRule(settings: unknown, id: string): Record<string, unknown> {
  const next = cloneSettings(settings);
  next.alertRules = sortStoredRules(rawRules(settings).filter((item) => !(isRecord(item) && item.id === id)));
  return next;
}

export function describeScope(
  rule: AlertRule,
  loanLabel: (loanId: string) => string | null,
  containerLabel: (containerId: string) => string | null,
): string {
  if (rule.scope === "any") return "Any loan";
  if (isContainerScope(rule.scope)) return containerLabel(rule.scope.containerId) ?? "1 account";
  return loanLabel(rule.scope.loanId) ?? "1 loan";
}

export function ruleAppliesTo(rule: AlertRule, loanId: string, containerId?: string | null): boolean {
  if (rule.scope === "any") return true;
  if (isContainerScope(rule.scope)) return containerId != null && rule.scope.containerId === containerId;
  return rule.scope.loanId === loanId;
}

export function containerIdByAccountId(
  containers: readonly { id: string; links: readonly { id: string }[] }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const container of containers) {
    for (const link of container.links) map.set(link.id, container.id);
  }
  return map;
}

export function alertLoan(input: {
  id: unknown;
  accountId: unknown;
  ltv: unknown;
  asset: unknown;
  collateralAsset: unknown;
}): AlertLoan | null {
  const id = idText(input.id);
  const accountId = idText(input.accountId);
  const asset = idText(input.asset);
  const collateralAsset = idText(input.collateralAsset);
  if (!id || !accountId || !asset || !collateralAsset) return null;
  if (typeof input.ltv !== "number" || !Number.isFinite(input.ltv)) return null;
  return { id, accountId, ltv: input.ltv, asset, collateralAsset };
}

/**
 * A rule is triggered when an applicable loan's LTV is at or above the
 * threshold. This is the in-app state only; it does not record a sent alert.
 */
export function evaluateAlertTriggers(
  rules: readonly AlertRule[],
  loans: readonly AlertLoan[],
  containerByAccountId: ReadonlyMap<string, string>,
): TriggerMatch[] {
  const matches: TriggerMatch[] = [];
  for (const loan of loans) {
    const containerId = containerByAccountId.get(loan.accountId);
    for (const rule of rules) {
      if (!ruleAppliesTo(rule, loan.id, containerId)) continue;
      if (loan.ltv < rule.ltv) continue;
      matches.push({
        ruleId: rule.id,
        loanId: loan.id,
        pair: `${loan.collateralAsset}/${loan.asset}`,
        ltv: loan.ltv,
        threshold: rule.ltv,
      });
    }
  }
  return matches;
}

/**
 * Live loans replace the snapshot when the exchange returns at least one.
 * An empty live list leaves a saved snapshot in place. A failed live call
 * uses the snapshot when one exists.
 */
export function chooseAlertLoans(input: {
  livePending: boolean;
  liveFailed: boolean;
  liveLoans: AlertLoan[] | null;
  snapshotPending: boolean;
  snapshotFailed: boolean;
  snapshotLoans: AlertLoan[] | null;
}): AlertLoanSource {
  if (input.livePending) return { status: "pending" };
  if (!input.liveFailed && input.liveLoans && input.liveLoans.length > 0) {
    return { status: "ready", source: "live", loans: input.liveLoans };
  }
  if (input.snapshotPending) return { status: "pending" };
  if (!input.snapshotFailed && input.snapshotLoans && input.snapshotLoans.length > 0) {
    return { status: "ready", source: "snapshot", loans: input.snapshotLoans };
  }
  if (!input.liveFailed && input.liveLoans) return { status: "ready", source: "live", loans: input.liveLoans };
  if (!input.snapshotFailed && input.snapshotLoans) {
    return { status: "ready", source: "snapshot", loans: input.snapshotLoans };
  }
  return { status: "unavailable" };
}
