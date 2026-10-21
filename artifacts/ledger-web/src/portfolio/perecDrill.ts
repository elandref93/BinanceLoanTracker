export type LayerPoint = {
  date: string;
  value: number | null;
  currency: string;
  change: number | null;
  product: string;
};

export type InvestmentLayer = {
  kind: "weib" | "eib";
  name: string;
  value: number | null;
  currency: string;
  points: LayerPoint[];
  inside: InvestmentLayer | null;
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
  return {
    kind: value.kind,
    name: value.name,
    value: amount,
    currency: typeof value.currency === "string" ? value.currency : "",
    points,
    inside,
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
