// Import first so Sentry initialises (and installs its process-level
// uncaught-exception / unhandled-rejection handlers) before anything else.
import "./lib/sentry";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureDataDir } from "./lib/dataDir";
import { startScheduler } from "./lib/scheduler";

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

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Resolve (and create) the persistence dir up front so an unwritable location
  // surfaces a single loud warning at boot rather than failing every write. On
  // permission errors this picks an ephemeral fallback so the API keeps serving;
  // any *other* failure is unexpected, so log it fatally and exit rather than
  // leak an unhandled rejection from this async listen callback.
  try {
    await ensureDataDir();
  } catch (err) {
    logger.fatal({ err }, "Failed to initialise data directory at boot");
    process.exit(1);
  }

  // Background LTV refresh (every 15m) so data stays fresh while the app is
  // closed. No-ops if CREDENTIAL_ENCRYPTION_KEY is unset. Requires Azure
  // "Always On" in production so the container doesn't idle out.
  startScheduler();
});
