import { useEffect, useState } from "react";

import { fmtPct } from "@/domain/format";
import { riskBand, riskBandLabel, type RiskBand } from "@/domain/risk";
import { bandStops } from "@/loans/loanModel";
import { useReducedMotion } from "@/ui/motion";
import { BAND_SHAPES, cx, riskColor, riskTextClass } from "@/ui/primitives";

const CX = 100;
const CY = 100;
const R = 82;
const STROKE = 14;

const ARC_OPACITY: Record<RiskBand, number> = { healthy: 0.9, above: 0.9, margin: 0.55, liquidation: 1 };

function polar(value: number, radius = R): { x: number; y: number } {
  const angle = (Math.min(100, Math.max(0, value)) / 100) * Math.PI;
  return { x: CX - radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

function arc(from: number, to: number): string {
  const a = polar(from);
  const b = polar(to);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)}A${R},${R} 0 0 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/** Sweeps from 0 to `value` once after mount, then follows later changes. */
function useSwept(value: number): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [reduced, value]);
  return shown;
}

/**
 * Half-dial LTV gauge over the four risk bands. The needle sweeps to the
 * value; the value, band name and band shape are always printed beneath.
 */
export function LtvGauge(props: { ltv: number | null; target: number; caption?: string; className?: string }) {
  const value = props.ltv != null && Number.isFinite(props.ltv) ? props.ltv : null;
  const band = value == null ? null : riskBand(value, props.target);
  const swept = useSwept(value ?? 0);
  const tick = { inner: polar(props.target, R - STROKE / 2 - 3), outer: polar(props.target, R + STROKE / 2 + 3) };
  const label = value == null ? "LTV unavailable" : `LTV ${fmtPct(value)}, ${riskBandLabel(band ?? "healthy")}. Target ${fmtPct(props.target, 0)}.`;

  return (
    <div className={cx("flex flex-col items-center", props.className)} role="img" aria-label={label}>
      <svg viewBox="0 0 200 112" className="w-full max-w-[260px] overflow-visible" aria-hidden="true">
        <path d={arc(0, 100)} fill="none" stroke="#1A242C" strokeWidth={STROKE} strokeLinecap="round" />
        {bandStops(props.target).map((stop, index, list) => (
          <path
            key={stop.band}
            d={arc(stop.from + (index === 0 ? 0 : 0.6), stop.to - (index === list.length - 1 ? 0 : 0.6))}
            fill="none"
            stroke={riskColor(stop.band)}
            strokeOpacity={ARC_OPACITY[stop.band]}
            strokeWidth={STROKE}
            strokeLinecap={index === 0 || index === list.length - 1 ? "round" : "butt"}
          />
        ))}
        <line x1={tick.inner.x} y1={tick.inner.y} x2={tick.outer.x} y2={tick.outer.y} stroke="#E8EEF2" strokeWidth={2} strokeLinecap="round" />
        {value != null ? (
          <g
            style={{
              transformOrigin: `${CX}px ${CY}px`,
              transformBox: "view-box",
              transform: `rotate(${(swept / 100) * 180}deg)`,
              transition: "transform 1100ms var(--ease-ledger)",
            }}
          >
            <line x1={CX} y1={CY} x2={CX - (R - 20)} y2={CY} stroke="#E8EEF2" strokeWidth={3} strokeLinecap="round" />
          </g>
        ) : null}
        <circle cx={CX} cy={CY} r={7} fill="#E8EEF2" />
        <circle cx={CX} cy={CY} r={3} fill="#06090C" />
      </svg>
      <p className={cx("-mt-1 text-[30px] font-semibold leading-9 tracking-tight tabular", band ? riskTextClass(band) : "text-muted-foreground")}>
        {value == null ? "—" : fmtPct(value)}
      </p>
      {band ? (
        <p className={cx("flex items-center gap-1.5 text-caption font-semibold", riskTextClass(band))}>
          <span aria-hidden="true" className="text-[0.7em]">
            {BAND_SHAPES[band]}
          </span>
          {riskBandLabel(band)}
        </p>
      ) : null}
      <p className="mt-0.5 text-micro text-muted-foreground tabular">{props.caption ?? `Target ${fmtPct(props.target, 0)}`}</p>
    </div>
  );
}

/** Thin 0–100% track with the band colours, a target tick and a marker at the LTV. */
export function LtvBar(props: { ltv: number; target: number; className?: string }) {
  const band = riskBand(props.ltv, props.target);
  const position = Math.min(100, Math.max(0, props.ltv));
  return (
    <span aria-hidden="true" className={cx("relative block h-1.5 rounded-full bg-[#1A242C]", props.className)}>
      {bandStops(props.target).map((stop) => (
        <span
          key={stop.band}
          className="absolute inset-y-0"
          style={{ left: `${stop.from}%`, width: `${stop.to - stop.from}%`, background: riskColor(stop.band), opacity: stop.band === "liquidation" ? 0.5 : 0.22 }}
        />
      ))}
      <span className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full" style={{ width: `${position}%`, background: riskColor(band), opacity: 0.9 }} />
      <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/80" style={{ left: `calc(${props.target}% - 1px)` }} />
    </span>
  );
}
