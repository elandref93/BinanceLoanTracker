/** South Africa has no daylight saving: Johannesburg is always UTC+2. */
export const JHB_OFFSET_MS = 2 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** Johannesburg calendar day (yyyy-mm-dd) for an instant. */
export function jhbDay(ms: number): string {
  return new Date(ms + JHB_OFFSET_MS).toISOString().slice(0, 10);
}

/** First instant of a Johannesburg day. */
export function jhbDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - JHB_OFFSET_MS;
}

/** Last instant (exclusive end) of a Johannesburg day. */
export function jhbDayEnd(day: string): number {
  return jhbDayStart(day) + DAY_MS;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of days from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** Monday that starts the Johannesburg week containing `ms`. */
export function jhbWeekStart(ms: number): string {
  const day = jhbDay(ms);
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function jhbMonthStart(ms: number): string {
  return `${jhbDay(ms).slice(0, 7)}-01`;
}

/**
 * South African tax year containing `ms`: 1 March to the end of February.
 * Returns the label (e.g. "2026/27") and its Johannesburg day bounds.
 */
export function saTaxYear(ms: number): { label: string; from: string; to: string } {
  const day = jhbDay(ms);
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const startYear = month >= 3 ? year : year - 1;
  const from = `${startYear}-03-01`;
  const to = addDays(`${startYear + 1}-03-01`, -1);
  return { label: `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`, from, to };
}
