/**
 * Display preferences stored in the shared settings blob. The web writes
 * `currency`, `webPerson`, `webScope`, and `webDiscreet`. Every other field
 * (alert rules, targets, phone fields) is kept as it was.
 *
 * `webPerson` is who the figures are for: the signed-in user, or one child.
 * `webScope` is an optional cut of the user's own profiles (everything, one
 * personal profile, or the trust). A child is never stored as a profile scope.
 */

export type DisplayCurrency = "USD" | "ZAR";
export type ScopeId = "all" | string;
export type PersonId = "user" | (typeof CHILD_SCOPE_PROFILES)[number]["id"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredId(settings: unknown, key: string): string | null {
  if (!isRecord(settings)) return null;
  const raw = settings[key];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) return null;
  return raw;
}

export function readStoredScope(settings: unknown): ScopeId | null {
  return readStoredId(settings, "webScope");
}

export function readStoredPerson(settings: unknown): PersonId | null {
  const raw = readStoredId(settings, "webPerson");
  return raw && isPersonId(raw) ? raw : null;
}

/** A saved profile id that no longer exists falls back to the user's combined view. Child ids are people, not profiles. */
export function resolveScope(scope: ScopeId | null, containers: ReadonlyArray<{ id: string }>): ScopeId {
  if (!scope || scope === "all" || isChildScope(scope)) return "all";
  return containers.some((container) => container.id === scope) ? scope : "all";
}

/**
 * An explicit person wins. A child id left in the old profile slot still
 * selects that child, and the profile slot itself falls back to the combined view.
 */
export function resolvePerson(person: PersonId | null, scope: ScopeId | null): PersonId {
  if (person && isPersonId(person)) return person;
  if (scope && isChildScope(scope)) return scope;
  return "user";
}

export function isPersonId(value: string): value is PersonId {
  return value === "user" || isChildScope(value);
}

/**
 * Choosing the user again, after a child, restores trust and their own
 * investments together. Choosing a child leaves the profile slot alone.
 */
export function selectPerson(current: { person: PersonId; scope: ScopeId }, next: PersonId): { person: PersonId; scope: ScopeId } {
  if (next === "user" && current.person !== "user") return { person: "user", scope: "all" };
  return { person: next, scope: current.scope };
}

/** What the portfolio APIs should filter by. A child replaces the profile cut; the user's combined view does not. */
export function viewScope(person: PersonId, scope: ScopeId): ScopeId {
  return person === "user" ? scope : person;
}

export function applyPreferenceEdit(
  settings: unknown,
  edit: { currency?: DisplayCurrency; scope?: ScopeId; person?: PersonId; discreet?: boolean },
): Record<string, unknown> {
  const next = isRecord(settings) ? { ...settings } : {};
  if (edit.currency === "USD" || edit.currency === "ZAR") next.currency = edit.currency;
  if (typeof edit.scope === "string" && edit.scope.length > 0 && !isChildScope(edit.scope)) next.webScope = edit.scope;
  if (edit.person && isPersonId(edit.person)) {
    next.webPerson = edit.person;
    if (typeof next.webScope === "string" && isChildScope(next.webScope)) next.webScope = "all";
  }
  if (typeof edit.discreet === "boolean") next.webDiscreet = edit.discreet;
  return next;
}

export const CHILD_SCOPE_PROFILES = [
  { id: "child:laden", name: "Laden" },
  { id: "child:ivelle", name: "Ivelle" },
  { id: "child:greyson", name: "Greyson" },
] as const;

export function isChildScope(scope: string): scope is (typeof CHILD_SCOPE_PROFILES)[number]["id"] {
  return CHILD_SCOPE_PROFILES.some((profile) => profile.id === scope);
}

export type ScopeChoice = { id: ScopeId; title: string; caption?: string; type?: string };
export type PersonChoice = { id: PersonId; title: string; caption?: string };

/** The user's combined view, then each of the user's profiles. Children are a separate control. */
export function scopeChoices(containers: ReadonlyArray<{ id: string; name: string; type?: string; label?: string }>): ScopeChoice[] {
  return [
    { id: "all", title: "All profiles", caption: "Trust and your investments" },
    ...containers.map((container) => ({
      id: container.id,
      title: shortProfileName(container),
      type: container.type,
    })),
  ];
}

/** The signed-in user, then each child. This list never includes Personal or the trust. */
export function personChoices(userTitle = "You"): PersonChoice[] {
  return [
    { id: "user", title: userTitle, caption: "Your investments and the trust" },
    ...CHILD_SCOPE_PROFILES.map((profile) => ({ id: profile.id, title: profile.name })),
  ];
}

/** First name from the session, or "You" when the session has no usable name. */
export function userPersonTitle(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || trimmed.includes("@")) return "You";
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (!first || first.length > 24) return "You";
  return first;
}

export function personLabel(person: PersonId, userTitle = "You"): string {
  if (person === "user") return userTitle;
  return CHILD_SCOPE_PROFILES.find((profile) => profile.id === person)?.name ?? userTitle;
}

export function scopeLabel(scope: ScopeId, containers: ReadonlyArray<{ id: string; name: string }>): string {
  if (scope === "all" || isChildScope(scope)) return "All profiles";
  return containers.find((container) => container.id === scope)?.name ?? "All profiles";
}

/** "Trust · Family Trust" reads as "Family Trust"; a bare type stays as is. */
export function shortProfileName(container: { name: string; type?: string; label?: string }): string {
  const label = container.label?.trim();
  if (label) return label;
  const parts = container.name.split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ") : container.name;
}
