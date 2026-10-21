/**
 * Persists Entra object id → canonical Ledger user aliases.
 *
 * The alias file is separate from Apple identity data. This module never
 * rewrites canonical Apple user ids or the sha256(sub) blob filenames.
 * Pairing codes are not issued here: when the pure decision is unlinked,
 * the caller must not mint a session.
 */

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { ensureDataDir, getDataDir } from "./dataDir";
import { listAppleEmailBindings } from "./appleIdentities";
import { logger } from "./logger";
import {
  decideMicrosoftLink,
  type MicrosoftLinkDecision,
} from "./microsoftLinkDecision";

const FILE_NAME = "microsoft_identities.json";

interface AliasStore {
  version: 1;
  aliases: Record<string, string>;
}

function emptyStore(): AliasStore {
  return { version: 1, aliases: {} };
}

function filePath(): string {
  return path.join(getDataDir(), FILE_NAME);
}

function parseStore(raw: string): AliasStore {
  const parsed = JSON.parse(raw) as Partial<AliasStore>;
  const aliases =
    parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
      ? Object.fromEntries(
          Object.entries(parsed.aliases).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" &&
              typeof entry[1] === "string" &&
              entry[0].length > 0 &&
              entry[1].length > 0,
          ),
        )
      : {};
  return { version: 1, aliases };
}

async function loadStore(): Promise<AliasStore> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePath(), "utf8");
    return parseStore(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    logger.warn(
      { err, op: "auth.microsoft.identities" },
      "microsoftIdentities: read failed, starting empty",
    );
    return emptyStore();
  }
}

async function saveStore(store: AliasStore): Promise<void> {
  await ensureDataDir();
  const target = filePath();
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const body = JSON.stringify({ version: 1, aliases: store.aliases });
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

export async function resolveMicrosoftUser(input: {
  entraObjectId: string;
  email?: string;
  emailVerified: boolean;
}): Promise<MicrosoftLinkDecision> {
  return withLock(async () => {
    const [candidates, store] = await Promise.all([
      listAppleEmailBindings(),
      loadStore(),
    ]);
    const existingAliasCanonical = store.aliases[input.entraObjectId];
    const decision = decideMicrosoftLink({
      entraObjectId: input.entraObjectId,
      email: input.email,
      emailVerified: input.emailVerified,
      existingAliasCanonical,
      candidates,
    });

    if (decision.outcome !== "linked") {
      logger.info(
        {
          op: "auth.microsoft.link",
          reason: decision.reason,
          emailVerified: input.emailVerified,
          hasEmail: Boolean(input.email),
        },
        "microsoftIdentities: no canonical match — alias not written",
      );
      return decision;
    }

    if (store.aliases[input.entraObjectId] !== decision.canonicalSub) {
      store.aliases[input.entraObjectId] = decision.canonicalSub;
      await saveStore(store);
    }

    logger.info(
      {
        op: "auth.microsoft.link",
        userId: decision.canonicalSub,
        source: decision.source,
        linked: true,
      },
      "microsoftIdentities: resolved canonical user",
    );
    return decision;
  });
}
