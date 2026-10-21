// Import first so Sentry initialises (and installs its process-level
// uncaught-exception / unhandled-rejection handlers) before anything else.
import "./lib/sentry";
import app from "./app";
import { logger } from "./lib/logger";
import {
  ensureDataDir,
  getDataDir,
  isAppServiceStorageEnabled,
  isAzureHost,
  isUsingEphemeralDataDir,
} from "./lib/dataDir";
import { migratePlaintextAccountSecrets } from "./lib/migrateAccountSecrets";
import { evaluateProductionStartup } from "./lib/productionStartup";
import { startScheduler } from "./lib/scheduler";
import { isCryptoConfigured } from "./lib/secretCrypto";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function prepareServer(): Promise<void> {
  // Resolve (and create) the persistence dir up front so an unwritable location
  // surfaces a single loud warning at boot rather than failing every write. On
  // permission errors this picks an ephemeral fallback so local/dev keeps
  // serving; any *other* failure is unexpected and stops the process.
  try {
    await ensureDataDir();
  } catch (err) {
    logger.fatal({ err }, "Failed to initialise data directory at boot");
    process.exit(1);
  }

  // Production refuses to listen when the encryption key, persistent data
  // directory, or ALLOWED_ORIGINS is missing. /api/healthz stays a cheap
  // liveness probe and is still the Azure recycle path — these checks are
  // not added there.
  const startup = evaluateProductionStartup({
    nodeEnv: process.env.NODE_ENV,
    azureHost: isAzureHost(),
    appServiceStorageEnabled: isAppServiceStorageEnabled(),
    encryptionKeyConfigured: isCryptoConfigured(),
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    dataDirIsEphemeralFallback: isUsingEphemeralDataDir(),
  });
  if (startup.missing.length > 0) {
    const details = {
      op: "startup",
      missing: startup.missing,
      ephemeralDataDir: isUsingEphemeralDataDir(),
      dataDir: getDataDir(),
      azureHost: isAzureHost(),
      appServiceStorage: isAppServiceStorageEnabled(),
    };
    if (startup.enforce) {
      logger.fatal(details, "production startup checks failed");
      process.exit(1);
    }
    logger.warn(details, "startup configuration incomplete");
  }

  try {
    const summary = await migratePlaintextAccountSecrets();
    logger.info(
      { op: "creds.migrate", ...summary },
      "account secret migration finished",
    );
  } catch (err) {
    logger.error({ err, op: "creds.migrate" }, "account secret migration failed");
    if (process.env.NODE_ENV === "production") process.exit(1);
  }
}

void prepareServer()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");

      // Background LTV refresh (every 15m) so data stays fresh while the app is
      // closed. No-ops if CREDENTIAL_ENCRYPTION_KEY is unset. Requires Azure
      // "Always On" in production so the container doesn't idle out.
      startScheduler();
    });
  })
  .catch((err: unknown) => {
    logger.fatal({ err }, "server failed during startup");
    process.exit(1);
  });
