import { type IRouter } from "express";
import { stripAccountSyncSecrets } from "../lib/stripAccountSecrets";
import { makeSyncRouter } from "./syncFactory";

// Cross-device account sync. The payload (`containers`) is opaque to the
// server — the mobile app owns its shape — except exchange secrets, which are
// removed before every write so the installed app cannot push plaintext keys
// back. Other account metadata is preserved. Mobile last-write-wins still
// uses the client `updatedAt`. Web writes omit it and the server assigns
// the timestamp. Bearer auth is unchanged. See syncFactory for the contract.
const router: IRouter = makeSyncRouter({
  kind: "accounts",
  payloadKey: "containers",
  validatePayload: (v) => Array.isArray(v),
  sanitizePayload: stripAccountSyncSecrets,
});

export default router;
