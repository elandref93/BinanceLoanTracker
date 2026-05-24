import Svg, { Path, Line } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface Props {
  values: number[];
  width: number;
  height: number;
  color?: string;
  reference?: number;
}

export function Sparkline({ values, width, height, color, reference }: Props) {
  const colors = useColors();
  const stroke = color ?? colors.primary;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 4;
  const innerH = height - padY * 2;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });
  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
  const refY =
    reference != null
      ? padY + innerH - ((reference - min) / range) * innerH
      : null;
  return (
    <Svg width={width} height={height}>
      {refY != null ? (
        <Line
          x1={0}
          x2={width}
          y1={refY}
          y2={refY}
          stroke={colors.mutedForeground}
          strokeDasharray="3,3"
          strokeWidth={1}
        />
      ) : null}
      <Path d={d} stroke={stroke} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}
