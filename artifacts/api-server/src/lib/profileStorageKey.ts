/**
 * Existing production account-sync filename for the allowlisted web Apple
 * email. Those files are already named sha256(original Apple sub). Web
 * sign-in uses this key as the session user id, and file reads use it as the
 * filename. sha256(web Apple sub) must not become a new filename.
 */
export const CLERK_PROFILE_STORAGE_KEY = "d609e13453c430118d09dcbe8ff7419546c0e4bf2531bb0f633d4725c3bc2c2d";

export function isDirectStorageKey(sub: string): boolean {
  return sub === CLERK_PROFILE_STORAGE_KEY;
}
