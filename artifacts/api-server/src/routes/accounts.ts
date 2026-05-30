import { type IRouter } from "express";
import { makeSyncRouter } from "./syncFactory";

// Cross-device account sync. The payload (`containers`) is opaque to the
// server — the mobile app owns its shape. Last-write-wins by client
// `updatedAt`; see syncFactory for the contract.
const router: IRouter = makeSyncRouter({
  kind: "accounts",
  payloadKey: "containers",
  validatePayload: (v) => Array.isArray(v),
});

export default router;
