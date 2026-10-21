/** True when a portfolio response was built from the saved LTV snapshot. */
export function isSavedSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("flags" in value)) return false;
  const flags = (value as { flags?: unknown }).flags;
  return Array.isArray(flags) && flags.some((flag) => flag === "saved_snapshot");
}
