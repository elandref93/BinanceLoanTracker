export type LayerPoint = {
  date: string;
  value: number | null;
  currency: string;
  change: number | null;
  product: string;
};

export type LookthroughLine = {
  kind: "cash" | "asset";
  name: string;
  quantity: number | null;
  value: number | null;
  currency: string;
};

export type InvestmentLayer = {
  kind: "weib" | "eib";
  name: string;
  value: number | null;
  currency: string;
  points: LayerPoint[];
  inside: InvestmentLayer | null;
  /** Latest look-through lines. Empty when the portal did not return them. */
  lines?: LookthroughLine[];
  /** False when this EIB exists but the portal did not return its lines. */
  linesAvailable?: boolean;
  /** Portal day for `lines` (YYYY-MM-DD). */
  linesAsOf?: string;
  /** Deepest-fund total. Null when the source left it blank. Not the daily series. */
  netAssetValue?: number | null;
  /** Deepest-fund cash total. Null when the source left it blank. */
  cashTotal?: number | null;
};

export type DrillStep = "investment" | "weib" | "eib";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function readPoint(value: unknown): LayerPoint | null {
  if (!isRecord(value) || typeof value.date !== "string" || typeof value.product !== "string") return null;
  const amount = readValue(value.value);
  const change = readValue(value.change);
  if (amount === undefined || change === undefined) return null;
  return {
    date: value.date,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    change,
    product: value.product,
  };
}

function readLine(value: unknown): LookthroughLine | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "cash" && value.kind !== "asset") return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const quantity = readValue(value.quantity);
  const amount = readValue(value.value);
  if (quantity === undefined || amount === undefined) return null;
  return {
    kind: value.kind,
    name: value.name,
    quantity,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
  };
}

function readTotal(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return readValue(value) === undefined ? null : readValue(value);
}

/** Parses one layer. A null value stays null and is not a failed fetch. */
export function readInvestmentLayer(value: unknown): InvestmentLayer | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "weib" && value.kind !== "eib") return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const amount = readValue(value.value);
  if (amount === undefined) return null;
  if (!Array.isArray(value.points)) return null;
  const points: LayerPoint[] = [];
  for (const point of value.points) {
    const parsed = readPoint(point);
    if (parsed) points.push(parsed);
  }
  const inside = value.inside == null ? null : readInvestmentLayer(value.inside);
  const linesAvailable = value.linesAvailable === false ? false : value.linesAvailable === true ? true : undefined;
  const lines: LookthroughLine[] = [];
  if (linesAvailable !== false && Array.isArray(value.lines)) {
    for (const line of value.lines) {
      const parsed = readLine(line);
      if (parsed) lines.push(parsed);
    }
  }
  const netAssetValue = readTotal(value.netAssetValue);
  const cashTotal = readTotal(value.cashTotal);
  const linesAsOf = typeof value.linesAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.linesAsOf) ? value.linesAsOf : undefined;
  return {
    kind: value.kind,
    name: value.name,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    points,
    inside,
    ...(linesAvailable === undefined ? {} : { linesAvailable }),
    ...(linesAvailable === false ? { lines: [] } : lines.length > 0 ? { lines } : {}),
    ...(linesAsOf ? { linesAsOf } : {}),
    ...(netAssetValue === undefined ? {} : { netAssetValue }),
    ...(cashTotal === undefined ? {} : { cashTotal }),
  };
}

/** Lines to show on this layer. Unavailable wins over any cash or asset rows. */
export function lookthroughLines(layer: InvestmentLayer): { assets: LookthroughLine[]; cash: LookthroughLine[] } | "unavailable" | null {
  if (layer.linesAvailable === false) return "unavailable";
  if (!layer.lines || layer.lines.length === 0) return null;
  return {
    assets: layer.lines.filter((line) => line.kind === "asset"),
    cash: layer.lines.filter((line) => line.kind === "cash"),
  };
}

export function parseDrillStep(raw: string | null): DrillStep {
  if (raw === "weib" || raw === "eib") return raw;
  return "investment";
}

/** What the current screen shows, and the next layer the user can open. */
export function layerForStep(root: InvestmentLayer | null, step: DrillStep): { current: InvestmentLayer | null; next: InvestmentLayer | null } {
  if (!root || step === "investment") return { current: null, next: root?.kind === "weib" ? root : null };
  if (step === "weib") {
    if (root.kind !== "weib") return { current: null, next: null };
    return { current: root, next: root.inside?.kind === "eib" ? root.inside : null };
  }
  const eib = root.kind === "eib" ? root : root.inside?.kind === "eib" ? root.inside : null;
  return { current: eib, next: null };
}

export function investmentPath(asset: string, step: DrillStep = "investment"): string {
  const path = `/portfolio/${encodeURIComponent(asset)}`;
  if (step === "investment") return path;
  return `${path}?inside=${step}`;
}

export function productLabel(product: string): string {
  if (product === "brokerage") return "Brokerage";
  if (product === "perec-as") return "Asset swap";
  if (product === "perec-weib") return "WEIB";
  if (product === "perec-eib") return "EIB";
  return product;
}
