import type { ContainerInfo } from "./types";

/**
 * The three children each have their own profile. Statement rows for Laden
 * spell the name Landen; Elandre is a different name and does not match.
 * A row is assigned only when exactly one of these names appears.
 */
export const CHILD_PROFILES: readonly { id: string; name: string; pattern: RegExp }[] = [
  { id: "child:laden", name: "Laden", pattern: /\b(laden|landen)\b/i },
  { id: "child:ivelle", name: "Ivelle", pattern: /\bivelle\b/i },
  { id: "child:greyson", name: "Greyson", pattern: /\bgreyson\b/i },
];

export function isChildProfileId(id: string | null | undefined): boolean {
  return typeof id === "string" && CHILD_PROFILES.some((profile) => profile.id === id);
}

export function childProfileById(id: string): { id: string; name: string } | null {
  return CHILD_PROFILES.find((profile) => profile.id === id) ?? null;
}

/** The child named by these labels, or null when none match or more than one matches. */
export function childProfileForLabel(parts: readonly string[]): string | null {
  const haystack = parts.filter((part) => part.trim().length > 0).join("\n");
  if (!haystack) return null;
  const hits = CHILD_PROFILES.filter((profile) => profile.pattern.test(haystack));
  return hits.length === 1 ? hits[0].id : null;
}

export function ensureChildProfiles(containers: readonly ContainerInfo[]): ContainerInfo[] {
  const ids = new Set(containers.map((container) => container.id));
  const missing = CHILD_PROFILES.filter((profile) => !ids.has(profile.id));
  if (missing.length === 0) return [...containers];
  return [
    ...containers,
    ...missing.map((profile) => ({
      id: profile.id,
      name: profile.name,
      type: "child",
      linkIds: [],
      targetLtv: null,
    })),
  ];
}
