import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { ensureDataDir, getDataDir } from "./dataDir";
import {
  mergePlaintextLinksByHash,
  type PlaintextCredentialLink,
} from "./credentialStore";
import { logSubject, logger } from "./logger";
import { isCryptoConfigured } from "./secretCrypto";
import { stripAccountSyncSecrets } from "./stripAccountSecrets";

/**
 * One-time, repeatable move of plaintext exchange secrets out of account-sync
 * blobs (`sha256(sub).json`) into the encrypted credential file
 * (`sha256(sub).creds.json`).
 *
 * The filename hash is the canonical user key. This module never renames
 * files and never rewrites Apple or Microsoft identity maps.
 *
 * Rollback: sealed credentials are written first. The blob is stripped only
 * after that write succeeds. An existing sealed link is left untouched, so a
 * rerun cannot wipe or rotate ciphertext. If the credential file is
 * unreadable or the merge would exceed the per-exchange limit, the blob is
 * left as it was.
 */

const ACCOUNT_BLOB = /^[a-f0-9]{64}\.json$/;
const SECRET_FIELDS = new Set(["apiKey", "apiSecret"]);

export interface AccountSecretMigrationSummary {
  scanned: number;
  migrated: number;
  alreadyClean: number;
  skipped: number;
  linksAdded: number;
  linksKept: number;
}

type Exchange = PlaintextCredentialLink["exchange"];

interface Frame {
  exchange?: Exchange;
  id?: string;
  name?: string;
}

interface ExtractProblems {
  incomplete: boolean;
  unplaced: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isExchange(value: unknown): value is Exchange {
  return value === "binance" || value === "luno";
}

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasSecretField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretField);
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (SECRET_FIELDS.has(key)) return true;
    if (hasSecretField(value[key])) return true;
  }
  return false;
}

function walk(
  value: unknown,
  frame: Frame,
  found: PlaintextCredentialLink[],
  problems: ExtractProblems,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, frame, found, problems);
    return;
  }
  if (!isPlainObject(value)) return;

  const next: Frame = {
    exchange: isExchange(value.exchange) ? value.exchange : frame.exchange,
    id: asNonEmpty(value.id) ?? frame.id,
    name: asNonEmpty(value.label) ?? asNonEmpty(value.name) ?? frame.name,
  };

  const rawKey = typeof value.apiKey === "string" ? value.apiKey : "";
  const rawSecret = typeof value.apiSecret === "string" ? value.apiSecret : "";
  const apiKey = asNonEmpty(value.apiKey);
  const apiSecret = asNonEmpty(value.apiSecret);
  if (apiKey && apiSecret) {
    if (!next.exchange || !next.id) problems.unplaced = true;
    else {
      found.push({
        exchange: next.exchange,
        id: next.id,
        name: next.name ?? next.id,
        apiKey,
        apiSecret,
      });
    }
  } else if (rawKey.trim() || rawSecret.trim()) {
    problems.incomplete = true;
  }

  for (const key of Object.keys(value)) {
    if (SECRET_FIELDS.has(key)) continue;
    walk(value[key], next, found, problems);
  }
}

function extractLinks(payload: unknown): {
  links: PlaintextCredentialLink[];
  blockedReason: "incomplete_secret" | "unplaced_secret" | "conflicting_plaintext" | null;
} {
  const found: PlaintextCredentialLink[] = [];
  const problems: ExtractProblems = { incomplete: false, unplaced: false };
  walk(payload, {}, found, problems);
  if (problems.incomplete) return { links: [], blockedReason: "incomplete_secret" };
  if (problems.unplaced) return { links: [], blockedReason: "unplaced_secret" };

  const byId = new Map<string, PlaintextCredentialLink>();
  for (const link of found) {
    const key = `${link.exchange}:${link.id}`;
    const previous = byId.get(key);
    if (
      previous &&
      (previous.apiKey !== link.apiKey || previous.apiSecret !== link.apiSecret)
    ) {
      return { links: [], blockedReason: "conflicting_plaintext" };
    }
    byId.set(key, link);
  }
  return { links: [...byId.values()], blockedReason: null };
}

async function writeAtomic(target: string, body: string): Promise<void> {
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

function emptySummary(): AccountSecretMigrationSummary {
  return {
    scanned: 0,
    migrated: 0,
    alreadyClean: 0,
    skipped: 0,
    linksAdded: 0,
    linksKept: 0,
  };
}

export async function migratePlaintextAccountSecrets(): Promise<AccountSecretMigrationSummary> {
  await ensureDataDir();
  const summary = emptySummary();
  const dir = getDataDir();
  const names = await fs.readdir(dir);
  const accountFiles = names.filter((name) => ACCOUNT_BLOB.test(name));
  summary.scanned = accountFiles.length;
  const cryptoReady = isCryptoConfigured();

  for (const name of accountFiles) {
    const hash = name.slice(0, -".json".length);
    const target = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (err) {
      summary.skipped += 1;
      logger.warn(
        { err, op: "creds.migrate", user: logSubject(hash), reason: "invalid_json" },
        "account secret migration skipped a blob",
      );
      continue;
    }

    if (!hasSecretField(parsed)) {
      summary.alreadyClean += 1;
      continue;
    }

    const extracted = extractLinks(parsed);
    if (extracted.blockedReason) {
      summary.skipped += 1;
      logger.warn(
        { op: "creds.migrate", user: logSubject(hash), reason: extracted.blockedReason },
        "account secret migration left the blob unchanged",
      );
      continue;
    }

    try {
      if (extracted.links.length > 0) {
        if (!cryptoReady) {
          summary.skipped += 1;
          logger.warn(
            { op: "creds.migrate", user: logSubject(hash), reason: "encryption_unavailable" },
            "account secret migration left the blob unchanged",
          );
          continue;
        }
        const merged = await mergePlaintextLinksByHash(hash, extracted.links);
        if (merged.status === "added") {
          summary.linksAdded += merged.linksAdded;
          summary.linksKept += merged.linksKept;
        } else if (merged.status === "unchanged") {
          summary.linksKept += merged.linksKept;
        } else {
          summary.skipped += 1;
          logger.warn(
            { op: "creds.migrate", user: logSubject(hash), reason: merged.status },
            "account secret migration left the blob unchanged",
          );
          continue;
        }
      }

      const stripped = stripAccountSyncSecrets(parsed);
      if (hasSecretField(stripped)) {
        summary.skipped += 1;
        logger.warn(
          { op: "creds.migrate", user: logSubject(hash), reason: "strip_incomplete" },
          "account secret migration left the blob unchanged",
        );
        continue;
      }

      await writeAtomic(target, JSON.stringify(stripped));
      summary.migrated += 1;
    } catch (err) {
      summary.skipped += 1;
      logger.error(
        { err, op: "creds.migrate", user: logSubject(hash), reason: "migrate_failed" },
        "account secret migration left this blob for a later retry",
      );
    }
  }

  return summary;
}
