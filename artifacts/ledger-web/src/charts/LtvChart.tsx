import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import { linePath, type Point } from "@/charts/geometry";
import { useElementSize } from "@/charts/useElementSize";
import { fmtPct } from "@/domain/format";
import { LIQ_LTV, WARNING_LTV, riskBand, type RiskBand } from "@/domain/risk";
import { bandStops, ltvDomain, type LtvSeriesPoint } from "@/loans/loanModel";
import { cx, riskColor } from "@/ui/primitives";

const PAD_TOP = 8;
const PAD_BOTTOM = 8;

const BAND_FILL: Record<RiskBand, { color: string; opacity: number }> = {
  healthy: { color: "#1FB6A6", opacity: 0.07 },
  above: { color: "#F5A524", opacity: 0.1 },
  margin: { color: "#FF4D6D", opacity: 0.14 },
  liquidation: { color: "#FF4D6D", opacity: 0.34 },
};

/** Index of the point nearest to time `t` (points are sorted by time). */
function nearestIndex(points: readonly LtvSeriesPoint[], t: number): number {
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((points[mid] as LtvSeriesPoint).t < t) low = mid;
    else high = mid;
  }
  const a = points[low] as LtvSeriesPoint;
  const b = points[high] as LtvSeriesPoint;
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? low : high;
}

/**
 * LTV over time on top of the four risk bands (healthy, above target, margin
 * call, liquidation). Every band boundary carries a text label so the colour
 * is never the only cue. X is true time, so gaps in history stay visible.
 */
export function LtvChart(props: {
  points: readonly LtvSeriesPoint[];
  target: number;
  label: string;
  onScrub?: (index: number | null) => void;
  className?: string;
}) {
  const { points, target, onScrub } = props;
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const [scrub, setScrub] = useState<number | null>(null);

  const [lo, hi] = useMemo(() => ltvDomain(points.map((point) => point.v)), [points]);
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const usable = Math.max(1, size.height - PAD_TOP - PAD_BOTTOM);
  const y = (value: number) => PAD_TOP + usable - ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo || 1)) * usable;
  const x = (t: number) => (t1 > t0 ? ((t - t0) / (t1 - t0)) * size.width : size.width / 2);

  const projected: Point[] = size.width > 0 ? points.map((point) => ({ x: x(point.t), y: y(point.v) })) : [];
  const d = linePath(projected);
  const last = points[points.length - 1];
  const lastBand = last ? riskBand(last.v, target) : "healthy";

  const report = (index: number | null) => {
    setScrub(index);
    onScrub?.(index);
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    if (event.pointerType === "mouse" && event.type === "pointerdown") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    report(nearestIndex(points, t0 + ratio * (t1 - t0)));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const step = Math.max(1, Math.round(points.length / 40));
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = scrub ?? points.length - 1;
      report(Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowLeft" ? -step : step))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      report(event.key === "Home" ? 0 : points.length - 1);
    } else if (event.key === "Escape") {
      report(null);
    }
  };

  const boundaries = [
    { value: target, label: `Target ${fmtPct(target, 0)}`, band: "above" as RiskBand },
    { value: WARNING_LTV, label: `Margin call ${fmtPct(WARNING_LTV, 0)}`, band: "margin" as RiskBand },
    { value: LIQ_LTV, label: `Liquidation ${fmtPct(LIQ_LTV, 0)}`, band: "liquidation" as RiskBand },
  ].filter((line) => line.value > lo && line.value < hi && !(line.band === "above" && line.value >= WARNING_LTV));
  const scrubPoint = scrub != null ? projected[scrub] : null;

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
      {size.width > 0 ? (
        <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
          {bandStops(target, 100).map((stop) => {
            const top = y(Math.min(stop.to, hi));
            const bottom = y(Math.max(stop.from, lo));
            if (bottom - top <= 0) return null;
            const fill = BAND_FILL[stop.band];
            return <rect key={stop.band} x={0} y={top} width={size.width} height={bottom - top} fill={fill.color} opacity={fill.opacity} />;
          })}
          {boundaries.map((line) => (
            <line key={line.label} x1={0} x2={size.width} y1={y(line.value)} y2={y(line.value)} stroke={riskColor(line.band)} strokeOpacity={0.55} strokeDasharray="3 4" strokeWidth={1} />
          ))}
          <path d={d} fill="none" stroke="#E8EEF2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="chart-draw" />
          {boundaries.map((line, index) => {
            const lineY = y(line.value);
            const crowded = index > 0 && Math.abs(lineY - y(boundaries[index - 1]?.value ?? line.value)) < 14;
            return (
              <text
                key={line.label}
                x={4}
                y={crowded ? lineY + 12 : lineY - 4}
                fontSize={10.5}
                fontWeight={600}
                fill={riskColor(line.band)}
                stroke="#0B1117"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="tabular"
              >
                {line.label}
              </text>
            );
          })}
          {projected.length > 0 && !scrubPoint ? (
            <circle
              cx={(projected[projected.length - 1] as Point).x}
              cy={(projected[projected.length - 1] as Point).y}
              r={4.5}
              fill={riskColor(lastBand)}
              stroke="#06090C"
              strokeWidth={2}
              className="animate-fade-in"
            />
          ) : null}
          {scrubPoint && scrub != null ? (
            <g>
              <line x1={scrubPoint.x} x2={scrubPoint.x} y1={0} y2={size.height} stroke="#3A4854" strokeWidth={1} />
              <circle cx={scrubPoint.x} cy={scrubPoint.y} r={9} fill={riskColor(riskBand(points[scrub]?.v ?? 0, target))} opacity={0.2} />
              <circle cx={scrubPoint.x} cy={scrubPoint.y} r={4.5} fill={riskColor(riskBand(points[scrub]?.v ?? 0, target))} stroke="#06090C" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
