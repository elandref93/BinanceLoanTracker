import { type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

export type DonutSegment = {
  /** Non-negative magnitude; segment arc is value / sum(values). */
  value: number;
  color: string;
};

type Props = {
  segments: DonutSegment[];
  /** Outer square size in px. Default 180. */
  size?: number;
  /** Ring thickness in px. Default 22. */
  strokeWidth?: number;
  /** Optional centre content (e.g. total label). */
  children?: ReactNode;
  /** Track colour drawn behind the segments. */
  trackColor?: string;
};

/**
 * Proportional donut/ring chart. Each segment occupies an arc equal to its
 * share of the total. Drawn with stroke-dash on concentric circles rotated so
 * the first segment starts at 12 o'clock and fills clockwise. Pure SVG — no
 * animation — so it renders identically on iOS and the web preview.
 */
export function DonutChart({
  segments,
  size = 180,
  strokeWidth = 22,
  children,
  trackColor = "rgba(127,127,127,0.15)",
}: Props) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const half = size / 2;

  let offset = 0;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${half}, ${half}`}>
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={trackColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {total > 0
            ? segments.map((seg, i) => {
                const frac = Math.max(0, seg.value) / total;
                if (frac <= 0) return null;
                const dash = circumference * frac;
                const node = (
                  <Circle
                    key={i}
                    cx={half}
                    cy={half}
                    r={r}
                    stroke={seg.color}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                  />
                );
                offset += dash;
                return node;
              })
            : null}
        </G>
      </Svg>
      {children ? (
        <View style={{ position: "absolute", alignItems: "center" }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
