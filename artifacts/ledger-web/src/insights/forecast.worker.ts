import { runForecast, type ForecastInput } from "@/insights/forecast";

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ id: number; input: ForecastInput }>) => void) | null;
  postMessage: (message: unknown) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    scope.postMessage({ id, result: runForecast(input) });
  } catch {
    scope.postMessage({ id, error: true });
  }
};
