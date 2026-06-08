import { Router, type IRouter } from "express";
import { readSnapshot } from "../lib/ltvSnapshot";

// Mounted at /api/ltv, behind requireAuth. Returns the latest server-computed
// LTV snapshot for the authenticated user (written by the scheduler). Lets the
// app show fresh numbers even if it was closed when the snapshot was computed.

const router: IRouter = Router();

router.get("/snapshot", async (req, res, next) => {
  try {
    const snap = await readSnapshot(req.userId!);
    if (!snap) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, snapshot: snap });
  } catch (err) {
    next(err);
  }
});

export default router;
