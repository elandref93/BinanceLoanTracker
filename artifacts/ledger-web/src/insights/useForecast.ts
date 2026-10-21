import { useEffect, useMemo, useRef, useState } from "react";

import type { ForecastInput, ForecastResult } from "@/insights/forecast";

type ForecastState = { result: ForecastResult | null; running: boolean; failed: boolean };

type WorkerReply = { id: number; result?: ForecastResult; error?: boolean };

/**
 * Runs the simulation off the main thread. The worker is created on first
 * use, so it only loads while Insights is open, and is shut down on leave.
 */
export function useForecast(input: ForecastInput | null): ForecastState {
  const key = useMemo(() => (input ? JSON.stringify(input) : null), [input]);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const [state, setState] = useState<ForecastState>({ result: null, running: input != null, failed: false });

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (key == null) {
      setState({ result: null, running: false, failed: false });
      return;
    }
    const payload = JSON.parse(key) as ForecastInput;
    const id = ++requestRef.current;
    setState((prev) => ({ result: prev.result, running: true, failed: false }));
    const finish = (reply: WorkerReply) => {
      if (reply.id !== requestRef.current) return;
      setState(reply.result ? { result: reply.result, running: false, failed: false } : { result: null, running: false, failed: true });
    };
    if (typeof Worker === "undefined") {
      let cancelled = false;
      void import("@/insights/forecast").then(({ runForecast }) => {
        if (!cancelled) finish({ id, result: runForecast(payload) });
      });
      return () => {
        cancelled = true;
      };
    }
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./forecast.worker.ts", import.meta.url), { type: "module", name: "ledger-forecast" });
    }
    const worker = workerRef.current;
    const onMessage = (event: MessageEvent<WorkerReply>) => finish(event.data);
    const onError = () => finish({ id, error: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, input: payload });
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
  }, [key]);

  return state;
}
