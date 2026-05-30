import { type IRouter } from "express";
import { makeSyncRouter } from "./syncFactory";

// Cross-device app-settings sync (target LTV + per-account overrides,
// display currency, alert rules). The payload (`settings`) is an opaque
// object owned by the mobile app. Last-write-wins by client `updatedAt`;
// see syncFactory for the contract.
const router: IRouter = makeSyncRouter({
  kind: "settings",
  payloadKey: "settings",
  validatePayload: (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v),
});

export default router;
