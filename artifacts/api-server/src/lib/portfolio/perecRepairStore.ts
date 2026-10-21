import { logger } from "../logger";
import { invalidateDerived } from "./derived";
import { gapFillEnabled } from "./gapFill";
import { repairPeresecHistory } from "./perecRepair";
import { updateHistory } from "./portfolioStore";

/**
 * Rewrites stored points whose Peresec lines are missing, negative, grossly
 * under-recorded, or labeled twice. Running it again writes nothing.
 */
export async function repairStoredPeresec(hash: string): Promise<string[]> {
  if (!gapFillEnabled(hash)) return [];
  let days: string[] = [];
  const wrote = await updateHistory(hash, (file) => {
    if (!file.latest) return null;
    const result = repairPeresecHistory(file.points, file.latest.statementSeries);
    days = result.days;
    return result.days.length > 0 ? result.points : null;
  });
  if (wrote) invalidateDerived(hash);
  if (days.length > 0) {
    logger.info({ op: "portfolio.perec-repair", days }, "repaired peresec snapshots that were missing, negative, or double-counted");
  }
  return days;
}
