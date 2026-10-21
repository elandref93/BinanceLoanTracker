import { type IRouter } from "express";
import { stripAccountSyncSecrets } from "../lib/stripAccountSecrets";
import { makeSyncRouter } from "./syncFactory";

// Cross-device strategy scenarios. The payload (`scenarios`) is the list the
// phone keeps in AsyncStorage under ledger.leverageScenarios.v1. It is its
// own blob: the phone replaces settings from currency, LTV targets, and alert
// rules, and it replaces annotations from the loan map. Mobile last-write-wins
// still uses the client `updatedAt`. Web writes omit it and the server
// assigns the timestamp. Exchange secret fields are removed; every other
// field on a scenario is stored as sent. See syncFactory for the contract.
const router: IRouter = makeSyncRouter({
  kind: "scenarios",
  payloadKey: "scenarios",
  validatePayload: (v) => Array.isArray(v),
  sanitizePayload: stripAccountSyncSecrets,
});

export default router;
