import { type IRouter } from "express";
import { makeSyncRouter } from "./syncFactory";

// Cross-device sync of per-loan user annotations (manual Luno sell rate,
// monthly contribution / target settlement date and goal mode). The payload
// (`annotations`) is an opaque map keyed by loanId, owned by the mobile app.
// Last-write-wins by client `updatedAt`; see syncFactory for the contract.
const router: IRouter = makeSyncRouter({
  kind: "annotations",
  payloadKey: "annotations",
  validatePayload: (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v),
});

export default router;
