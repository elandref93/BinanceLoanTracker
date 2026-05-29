import * as SecureStore from "expo-secure-store";

const KEY = "ledger.alertRules.v1";
const SEEDED_KEY = "ledger.alertRules.seeded.v1";

export type AlertScope =
  | "any"
  | { loanId: string }
  | { containerId: string };

export interface AlertRule {
  id: string;
  ltv: number;
  scope: AlertScope;
  label?: string;
}

export function isLoanScope(s: AlertScope): s is { loanId: string } {
  return typeof s === "object" && "loanId" in s;
}

export function isContainerScope(s: AlertScope): s is { containerId: string } {
  return typeof s === "object" && "containerId" in s;
}

const DEFAULT_RULES: AlertRule[] = [
  { id: "default_warn", ltv: 72, scope: "any", label: "Warning" },
  { id: "default_liq", ltv: 78, scope: "any", label: "Liquidation" },
];

export async function listAlertRules(): Promise<AlertRule[]> {
  const seeded = await SecureStore.getItemAsync(SEEDED_KEY);
  if (!seeded) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(DEFAULT_RULES));
    await SecureStore.setItemAsync(SEEDED_KEY, "1");
    return DEFAULT_RULES;
  }
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AlertRule[];
  } catch {
    return [];
  }
}

async function writeRules(rules: AlertRule[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(rules));
}

export async function upsertAlertRule(rule: AlertRule): Promise<AlertRule[]> {
  const rules = await listAlertRules();
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);
  rules.sort((a, b) => a.ltv - b.ltv);
  await writeRules(rules);
  return rules;
}

export async function deleteAlertRule(id: string): Promise<AlertRule[]> {
  const rules = (await listAlertRules()).filter((r) => r.id !== id);
  await writeRules(rules);
  return rules;
}

export function describeScope(
  rule: AlertRule,
  loanLabel: (loanId: string) => string,
  containerLabel?: (containerId: string) => string,
): string {
  if (rule.scope === "any") return "Any loan";
  if (isContainerScope(rule.scope)) {
    return containerLabel?.(rule.scope.containerId) ?? "1 account";
  }
  return loanLabel(rule.scope.loanId);
}

/**
 * Whether a rule applies to a given loan. `containerId` is the Personal/Trust
 * account that owns the loan — required to evaluate account-scoped rules.
 */
export function ruleAppliesTo(
  rule: AlertRule,
  loanId: string,
  containerId?: string | null,
): boolean {
  if (rule.scope === "any") return true;
  if (isContainerScope(rule.scope)) {
    return containerId != null && rule.scope.containerId === containerId;
  }
  return rule.scope.loanId === loanId;
}

export function makeRuleId(): string {
  return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
