import { useEffect, useState } from "react";

import {
  getLunoHistory,
  subscribe,
  type LunoSample,
} from "@/lib/lunoHistory";

/**
 * Read history filtered by currency, and re-read whenever a new sample
 * is written (via the module-level subscribe channel) so the sparkline
 * reflects the most recent record without waiting for a remount.
 */
export function useLunoHistory(hours: number, currency: string): LunoSample[] {
  const [samples, setSamples] = useState<LunoSample[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getLunoHistory(hours, currency).then((s) => {
        if (!cancelled) setSamples(s);
      });
    };
    refresh();
    const unsub = subscribe(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [hours, currency]);
  return samples;
}
