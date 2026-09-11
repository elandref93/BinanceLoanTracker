/**
 * Apple identity linking.
 *
 * Sign in with Apple `sub` is unique per (Apple ID, client id). TestFlight /
 * production (`com.ubuntu.life.ledger`) and Expo Go (`host.exp.Exponent`)
 * therefore mint different `sub`s for the same person. Account-sync blobs are
 * keyed by sha256(session JWT `sub`), so those two identities would otherwise
 * look like two empty/disjoint users.
 *
 * We persist a mapping in the same durable data dir as account sync
 * (`getDataDir()`, Azure `/home` when WEBSITES_ENABLE_APP_SERVICE_STORAGE is
 * on) so it survives App Service restarts:
 *   - aliases: Apple `sub` → canonical user id
 *   - emails:  verified email → canonical user id
 *
 * Linking is allowed only after the identity token has been verified, and only
 * when the token's email is present and verified (`email_verified` true when
 * the claim is present). Client-supplied emails are never consulted.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDataDir, getDataDir } from "./dataDir";
import { hasPersistedUserData } from "./accountStorage";
import { logger } from "./logger";

const FILE_NAME = "apple_identities.json";

interface IdentityStore {
  version: 1;
  /** Apple `sub` → canonical user id (itself, or another Apple `sub`). */
  aliases: Record<string, string>;
  /** Normalized (trim + lowercase) email → canonical user id. */
  emails: Record<string, string>;
}

export type AppleLinkResolution =
  | "known_sub"
  | "linked_by_email"
  | "new"
  | "new_without_email";

export type AppleLinkWarning = "email_not_shared" | "private_relay_unlinked";

export interface ResolveAppleUserInput {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

export interface ResolveAppleUserResult {
  canonicalSub: string;
  email?: string;
  resolution: AppleLinkResolution;
  warning: AppleLinkWarning | null;
}

function emptyStore(): IdentityStore {
  return { version: 1, aliases: {}, emails: {} };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmailLinkable(
  email: string | undefined,
  emailVerified: boolean | undefined,
): email is string {
  if (typeof email !== "string" || email.trim() === "") return false;
  // `email_verified` true when present; a missing claim still allows linking
  // because Apple sometimes omits it while still including `email`.
  if (emailVerified === false) return false;
  return true;
}

function filePath(): string {
  return path.join(getDataDir(), FILE_NAME);
}

function parseStore(raw: string): IdentityStore {
  const parsed = JSON.parse(raw) as Partial<IdentityStore>;
  const aliases =
    parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
      ? Object.fromEntries(
          Object.entries(parsed.aliases).filter(
            (e): e is [string, string] =>
              typeof e[0] === "string" && typeof e[1] === "string" && e[0].length > 0 && e[1].length > 0,
          ),
        )
      : {};
  const emails =
    parsed.emails && typeof parsed.emails === "object" && !Array.isArray(parsed.emails)
      ? Object.fromEntries(
          Object.entries(parsed.emails).filter(
            (e): e is [string, string] =>
              typeof e[0] === "string" && typeof e[1] === "string" && e[0].length > 0 && e[1].length > 0,
          ),
        )
      : {};
  return { version: 1, aliases, emails };
}

async function loadStore(): Promise<IdentityStore> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath(), "utf8");
    return parseStore(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    logger.warn({ err, op: "auth.apple.identities" }, "appleIdentities: read failed, starting empty");
    return emptyStore();
  }
}

async function saveStore(store: IdentityStore): Promise<void> {
  await ensureDataDir();
  const target = filePath();
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const body = JSON.stringify({ version: 1, aliases: store.aliases, emails: store.emails });
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

function canonicalOf(store: IdentityStore, sub: string): string | undefined {
  const mapped = store.aliases[sub];
  if (!mapped) return undefined;
  // Follow one hop in case of a stale pointer after a rehome.
  return store.aliases[mapped] ?? mapped;
}

function emailForCanonical(store: IdentityStore, canonical: string): string | undefined {
  for (const [email, id] of Object.entries(store.emails)) {
    if (id === canonical) return email;
  }
  return undefined;
}

function rehome(store: IdentityStore, fromCanonical: string, toCanonical: string): void {
  if (fromCanonical === toCanonical) return;
  for (const [alias, canon] of Object.entries(store.aliases)) {
    if (canon === fromCanonical) store.aliases[alias] = toCanonical;
  }
  for (const [email, canon] of Object.entries(store.emails)) {
    if (canon === fromCanonical) store.emails[email] = toCanonical;
  }
  store.aliases[toCanonical] = toCanonical;
}

/**
 * Prefer the identity that already has on-disk profile data (TestFlight)
 * over an empty newly-seen `sub` (Expo Go). If both or neither have data,
 * `preferredIfTie` wins.
 */
async function pickCanonical(
  a: string,
  b: string,
  preferredIfTie: string,
): Promise<{ winner: string; bothHaveData: boolean }> {
  if (a === b) return { winner: a, bothHaveData: false };
  const aHas = await hasPersistedUserData(a);
  const bHas = await hasPersistedUserData(b);
  if (aHas && bHas) return { winner: preferredIfTie, bothHaveData: true };
  if (aHas) return { winner: a, bothHaveData: false };
  if (bHas) return { winner: b, bothHaveData: false };
  return { winner: preferredIfTie, bothHaveData: false };
}

let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

function warningFor(input: {
  resolution: AppleLinkResolution;
  isPrivateEmail?: boolean;
}): AppleLinkWarning | null {
  if (input.resolution === "new_without_email") return "email_not_shared";
  if (input.resolution === "new" && input.isPrivateEmail) {
    // Hide My Email is unique per Apple developer team. Expo Go's relay
    // address never matches TestFlight's, so a new private-relay user is
    // almost certainly unlinked from the production profile.
    return "private_relay_unlinked";
  }
  return null;
}

export async function resolveAppleUser(
  input: ResolveAppleUserInput,
): Promise<ResolveAppleUserResult> {
  return withLock(async () => {
    const store = await loadStore();
    const sub = input.sub;
    const emailKey = isEmailLinkable(input.email, input.emailVerified)
      ? normalizeEmail(input.email)
      : undefined;
    const existingCanonical = canonicalOf(store, sub);
    const emailOwnerRaw = emailKey ? store.emails[emailKey] : undefined;
    const emailOwner = emailOwnerRaw
      ? (canonicalOf(store, emailOwnerRaw) ?? emailOwnerRaw)
      : undefined;

    let canonical = existingCanonical;
    let resolution: AppleLinkResolution = existingCanonical ? "known_sub" : "new";
    let dirty = false;

    if (emailOwner && canonical && emailOwner !== canonical) {
      const { winner, bothHaveData } = await pickCanonical(emailOwner, canonical, emailOwner);
      if (bothHaveData) {
        logger.warn(
          {
            op: "auth.apple.link",
            reason: "both_have_data",
            userId: canonical,
          },
          "appleIdentities: email matches another user who also has data; not merging",
        );
      } else if (winner !== canonical) {
        rehome(store, canonical, winner);
        canonical = winner;
        resolution = "linked_by_email";
        dirty = true;
      } else if (winner !== emailOwner) {
        rehome(store, emailOwner, winner);
        resolution = "linked_by_email";
        dirty = true;
      }
    } else if (emailOwner && !canonical) {
      const { winner, bothHaveData } = await pickCanonical(emailOwner, sub, emailOwner);
      if (bothHaveData) {
        logger.warn(
          {
            op: "auth.apple.link",
            reason: "both_have_data",
            userId: sub,
          },
          "appleIdentities: email matches another user who also has data; not merging",
        );
        store.aliases[sub] = sub;
        canonical = sub;
        resolution = "new";
        dirty = true;
      } else if (winner === emailOwner) {
        store.aliases[sub] = emailOwner;
        canonical = emailOwner;
        resolution = "linked_by_email";
        dirty = true;
      } else {
        rehome(store, emailOwner, sub);
        store.aliases[sub] = sub;
        canonical = sub;
        resolution = "linked_by_email";
        dirty = true;
      }
    } else if (!canonical) {
      store.aliases[sub] = sub;
      canonical = sub;
      resolution = emailKey ? "new" : "new_without_email";
      dirty = true;
    }

    if (!canonical) {
      throw new Error("appleIdentities: failed to resolve canonical user");
    }

    if (!store.aliases[sub]) {
      store.aliases[sub] = canonical;
      dirty = true;
    }

    if (emailKey && !store.emails[emailKey]) {
      store.emails[emailKey] = canonical;
      dirty = true;
    }

    if (dirty) await saveStore(store);

    const sessionEmail = emailKey ?? emailForCanonical(store, canonical);

    logger.info(
      {
        op: "auth.apple.link",
        userId: canonical,
        appleSub: sub,
        resolution,
        linked: resolution === "linked_by_email",
        hasEmail: Boolean(sessionEmail),
        isPrivateEmail: Boolean(input.isPrivateEmail),
      },
      "appleIdentities: resolved canonical user",
    );

    return {
      canonicalSub: canonical,
      email: sessionEmail,
      resolution,
      warning: warningFor({
        resolution,
        isPrivateEmail: input.isPrivateEmail,
      }),
    };
  });
}
