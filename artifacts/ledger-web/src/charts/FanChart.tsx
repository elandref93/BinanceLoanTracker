import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import { linePath, paddedExtent, type Point } from "@/charts/geometry";
import { useElementSize } from "@/charts/useElementSize";
import { useDiscreet } from "@/prefs/DiscreetMode";
import { cx } from "@/ui/primitives";

const PAD_TOP = 10;
const PAD_BOTTOM = 10;
const AXIS_WIDTH = 56;
const MAX_POINTS = 160;

export type FanBands = { p10: readonly number[]; p25: readonly number[]; p50: readonly number[]; p75: readonly number[]; p90: readonly number[] };

function sampleDays(days: number): number[] {
  const step = Math.max(1, Math.ceil(days / MAX_POINTS));
  const out: number[] = [];
  for (let day = 0; day < days; day += step) out.push(day);
  out.push(days);
  return out;
}

/**
 * Percentile fan: the outer band holds 8 in 10 simulated outcomes, the inner
 * band the middle half, the line the median. A dashed line marks today's
 * value so "better or worse than now" reads at a glance.
 */
export function FanChart(props: {
  bands: FanBands;
  days: number;
  start: number;
  label: string;
  formatTick: (value: number) => string;
  onScrub?: (day: number | null) => void;
  className?: string;
}) {
  const { bands, days, start, onScrub } = props;
  const discreet = useDiscreet();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const [scrub, setScrub] = useState<number | null>(null);
  const sampled = useMemo(() => sampleDays(days), [days]);

  const [lo, hi] = useMemo(() => {
    const values = [start];
    for (const day of sampled) values.push(bands.p10[day] as number, bands.p90[day] as number);
    return paddedExtent(values.filter((value) => Number.isFinite(value)), 0.06);
  }, [bands, sampled, start]);

  const plotWidth = Math.max(1, size.width - AXIS_WIDTH);
  const usable = Math.max(1, size.height - PAD_TOP - PAD_BOTTOM);
  const x = (day: number) => (day / Math.max(1, days)) * plotWidth;
  const y = (value: number) => PAD_TOP + usable - ((value - lo) / (hi - lo || 1)) * usable;
  const line = (series: readonly number[]): Point[] => sampled.map((day) => ({ x: x(day), y: y(series[day] as number) }));

  const ready = size.width > 0;
  const band = (upper: readonly number[], lower: readonly number[]) => {
    if (!ready) return "";
    return `${linePath(line(upper))}L${linePath(line(lower).reverse()).slice(1)}Z`;
  };
  const ticks = [hi - (hi - lo) * 0.08, (hi + lo) / 2, lo + (hi - lo) * 0.08];

  const report = (day: number | null) => {
    setScrub(day);
    onScrub?.(day);
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.type === "pointerdown") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width - AXIS_WIDTH)));
    report(Math.round(ratio * days));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(1, Math.round(days / 30));
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = scrub ?? days;
      report(Math.min(days, Math.max(0, current + (event.key === "ArrowLeft" ? -step : step))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      report(event.key === "Home" ? 0 : days);
    } else if (event.key === "Escape") {
      report(null);
    }
  };

  const scrubX = scrub != null ? x(scrub) : null;

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={props.label}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onPointer}
      onPointerMove={onPointer}
      onPointerLeave={() => report(null)}
      onPointerCancel={() => report(null)}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") report(null);
      }}
      onBlur={() => report(null)}
      data-no-pull
      className={cx("relative select-none rounded-xl outline-none [touch-action:pan-y] focus-visible:ring-2 focus-visible:ring-primary/60", props.className)}
    >
      {ready ? (
        <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={plotWidth} y1={y(tick)} y2={y(tick)} stroke="#1C252D" strokeWidth={1} />
              <text
                x={size.width}
                y={y(tick) + 3.5}
                textAnchor="end"
                fontSize={10.5}
                fill="#7D8B97"
                className="tabular"
                data-balance={discreet.enabled ? "" : undefined}
              >
                {discreet.mask(props.formatTick(tick))}
              </text>
            </g>
          ))}
          <g className="animate-fade-in">
            <path d={band(bands.p90, bands.p10)} fill="var(--color-primary)" opacity={0.12} />
            <path d={band(bands.p75, bands.p25)} fill="var(--color-primary)" opacity={0.2} />
          </g>
          <line x1={0} x2={plotWidth} y1={y(start)} y2={y(start)} stroke="#E8EEF2" strokeOpacity={0.45} strokeDasharray="3 4" strokeWidth={1} />
          <text
            x={4}
            y={y(start) - 5}
            fontSize={10.5}
            fontWeight={600}
            fill="#C9D3DB"
            stroke="#0B1117"
            strokeWidth={4}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            Today
          </text>
          <path d={linePath(line(bands.p50))} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="chart-draw" />
          {scrubX != null && scrub != null ? (
            <g>
              <line x1={scrubX} x2={scrubX} y1={0} y2={size.height} stroke="#3A4854" strokeWidth={1} />
              <circle cx={scrubX} cy={y(bands.p90[scrub] as number)} r={3} fill="var(--color-primary)" opacity={0.6} />
              <circle cx={scrubX} cy={y(bands.p10[scrub] as number)} r={3} fill="var(--color-primary)" opacity={0.6} />
              <circle cx={scrubX} cy={y(bands.p50[scrub] as number)} r={4.5} fill="var(--color-primary)" stroke="#06090C" strokeWidth={2} />
            </g>
          ) : (
            <circle cx={x(days)} cy={y(bands.p50[days] as number)} r={4.5} fill="var(--color-primary)" stroke="#06090C" strokeWidth={2} className="animate-fade-in" />
          )}
        </svg>
      ) : null}
    </div>
  );
}
