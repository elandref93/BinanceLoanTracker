import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "ledger.ltvHistory.v1";
const MAX_SAMPLES = 7 * 24 * 4; // ~7d at 15-min cadence
const MIN_INTERVAL_MS = 60_000; // dedupe samples within 60s

export type LtvSample = {
  /** Epoch ms. */
  t: number;
  /** Aggregate LTV percent at that time. */
  ltv: number;
};

let cache: LtvSample[] | null = null;

async function read(): Promise<LtvSample[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as LtvSample[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(samples: LtvSample[]): Promise<void> {
  cache = samples;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(samples));
  } catch {
    // ignore — chart is a non-critical view
  }
}

/** Append the current LTV; ignored if the previous sample was <60s ago. */
export async function recordLtvSample(ltv: number): Promise<void> {
  if (!Number.isFinite(ltv) || ltv <= 0) return;
  const now = Date.now();
  const samples = await read();
  const last = samples[samples.length - 1];
  if (last && now - last.t < MIN_INTERVAL_MS) return;
  const next = [...samples, { t: now, ltv }].slice(-MAX_SAMPLES);
  await write(next);
}

/** Returns samples within the last `hours` window, oldest → newest. */
export async function getLtvHistory(hours: number): Promise<LtvSample[]> {
  const cutoff = Date.now() - hours * 3600 * 1000;
  const samples = await read();
  return samples.filter((s) => s.t >= cutoff);
}

export async function clearLtvHistory(): Promise<void> {
  cache = [];
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
