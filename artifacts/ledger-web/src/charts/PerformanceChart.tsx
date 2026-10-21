import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { areaPath, indexAt, lerpArrays, linePath, originalIndex, paddedExtent, project, resample } from "@/charts/geometry";
import { useElementSize } from "@/charts/useElementSize";
import { easeOutCubic, prefersReducedMotion } from "@/ui/motion";
import { cx } from "@/ui/primitives";

const SAMPLES = 160;
const MORPH_MS = 320;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;

export type ChartTone = "gain" | "loss" | "flat";

const STROKE: Record<ChartTone, string> = {
  gain: "#22C55E",
  loss: "#F43F5E",
  flat: "#8A9BA8",
};

/**
 * Net-worth line with a gradient area. Every series is resampled to the same
 * number of points so switching range morphs one path into the next. The
 * line draws in once on first paint. Scrubbing (pointer or arrow keys)
 * reports the original data index under the cursor.
 */
export function PerformanceChart(props: {
  values: readonly number[];
  /** Value the dashed baseline marks, usually the range start. */
  baseline?: number | null;
  tone: ChartTone;
  label: string;
  onScrub: (index: number | null) => void;
  className?: string;
}) {
  const { values, onScrub } = props;
  const gradientId = `chart${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const lineRef = useRef<SVGPathElement | null>(null);
  const areaRef = useRef<SVGPathElement | null>(null);
  const shown = useRef<number[] | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);

  const target = useMemo(() => resample(values, SAMPLES), [values]);
  const extent = useMemo(() => paddedExtent(props.baseline != null ? [...values, props.baseline] : [...values]), [values, props.baseline]);
  const box = useMemo(() => ({ width: size.width, height: size.height, top: PAD_TOP, bottom: PAD_BOTTOM }), [size.width, size.height]);

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const paint = (series: number[]) => {
      const points = project(series, box, extent);
      lineRef.current?.setAttribute("d", linePath(points));
      areaRef.current?.setAttribute("d", areaPath(points, size.height));
    };
    const from = shown.current;
    if (!from || prefersReducedMotion()) {
      shown.current = target;
      paint(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MORPH_MS);
      const current = lerpArrays(from, target, easeOutCubic(t));
      shown.current = current;
      paint(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [box, extent, size.height, size.width, target]);

  useEffect(() => {
    if (size.width <= 0 || drawn) return undefined;
    const id = window.setTimeout(() => setDrawn(true), 900);
    return () => window.clearTimeout(id);
  }, [drawn, size.width]);

  const report = (sample: number | null) => {
    setScrub(sample);
    onScrub(sample == null ? null : originalIndex(sample, SAMPLES, values.length));
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.type === "pointerdown") return;
    const rect = event.currentTarget.getBoundingClientRect();
    report(indexAt(event.clientX - rect.left, rect.width, SAMPLES));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const stepSize = Math.max(1, Math.round(SAMPLES / Math.max(2, values.length - 1)));
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const current = scrub ?? SAMPLES - 1;
      const next = Math.min(SAMPLES - 1, Math.max(0, current + (event.key === "ArrowLeft" ? -stepSize : stepSize)));
      report(next);
    } else if (event.key === "Escape" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (event.key === "Escape") report(null);
      else report(event.key === "Home" ? 0 : SAMPLES - 1);
    }
  };

  const scrubPoint = useMemo(() => {
    if (scrub == null || size.width <= 0) return null;
    const points = project(target, box, extent);
    return points[scrub] ?? null;
  }, [box, extent, scrub, size.width, target]);

  const baselineY =
    props.baseline != null && size.height > 0 ? project([props.baseline], { ...box, width: 1 }, extent)[0]?.y ?? null : null;
  const stroke = STROKE[props.tone];

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
      className={cx("relative select-none outline-none [touch-action:pan-y] focus-visible:ring-2 focus-visible:ring-primary/60 rounded-xl", props.className)}
    >
      {size.width > 0 ? (
        <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {baselineY != null ? (
            <line x1={0} x2={size.width} y1={baselineY} y2={baselineY} stroke="#26323C" strokeDasharray="3 5" strokeWidth={1} />
          ) : null}
          <path ref={areaRef} fill={`url(#${gradientId})`} className="animate-fade-in transition-[fill] duration-300" />
          <path
            ref={lineRef}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={drawn ? undefined : 1}
            className={cx("transition-[stroke] duration-300", drawn ? "" : "chart-draw")}
          />
          {scrubPoint ? (
            <g>
              <line x1={scrubPoint.x} x2={scrubPoint.x} y1={0} y2={size.height} stroke="#3A4854" strokeWidth={1} />
              <circle cx={scrubPoint.x} cy={scrubPoint.y} r={9} fill={stroke} opacity={0.18} />
              <circle cx={scrubPoint.x} cy={scrubPoint.y} r={4.5} fill={stroke} stroke="#06090C" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

/** Tiny trend line for tiles and rows. No interaction, no animation beyond a fade. */
export function Sparkline(props: { values: readonly number[]; tone: ChartTone; width?: number; height?: number; className?: string }) {
  const width = props.width ?? 72;
  const height = props.height ?? 24;
  const d = useMemo(() => {
    if (props.values.length < 2) return "";
    const series = props.values.length > 48 ? resample(props.values, 48) : [...props.values];
    return linePath(project(series, { width, height, top: 2, bottom: 2 }, paddedExtent(series, 0.02)));
  }, [height, props.values, width]);
  if (!d) return <span aria-hidden="true" className={cx("block", props.className)} style={{ width, height }} />;
  return (
    <svg width={width} height={height} aria-hidden="true" className={cx("overflow-visible animate-fade-in", props.className)}>
      <path d={d} fill="none" stroke={STROKE[props.tone]} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
