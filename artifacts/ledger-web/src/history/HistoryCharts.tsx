import { Balance, useDiscreet } from "@/prefs/DiscreetMode";

const WIDTH = 640;
const HEIGHT = 120;

function linePoints(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = WIDTH / Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const y = span === 0 ? HEIGHT / 2 : HEIGHT - 8 - ((value - min) / span) * (HEIGHT - 16);
      return `${index * step},${y}`;
    })
    .join(" ");
}

export function SeriesChart(props: { values: number[]; summary: string }) {
  const discreet = useDiscreet();
  if (props.values.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        <Balance text={props.summary} />
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      <svg role="img" aria-label={discreet.mask(props.summary)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-32 w-full text-primary">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={linePoints(props.values)} />
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        <Balance text={props.summary} />
      </figcaption>
    </figure>
  );
}

export function DailyChargeChart(props: {
  points: Array<{ day: string; usd: number }>;
  summary: string;
}) {
  const discreet = useDiscreet();
  if (props.points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Balance text={props.summary} />
      </p>
    );
  }
  const max = Math.max(...props.points.map((point) => point.usd), 0.0001);
  const slot = WIDTH / props.points.length;
  const barWidth = Math.max(1, slot - 2);
  return (
    <figure className="space-y-2">
      <svg role="img" aria-label={discreet.mask(props.summary)} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-32 w-full text-primary">
        {props.points.map((point, index) => {
          const barHeight = Math.max(0, (point.usd / max) * (HEIGHT - 8));
          return (
            <rect
              key={point.day}
              x={index * slot}
              y={HEIGHT - barHeight}
              width={barWidth}
              height={barHeight}
              fill="currentColor"
            />
          );
        })}
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        <Balance text={props.summary} />
      </figcaption>
    </figure>
  );
}

export function AprSparkline(props: { values: number[]; summary: string }) {
  const discreet = useDiscreet();
  if (props.values.length < 2) return null;
  return (
    <svg
      role="img"
      aria-label={discreet.mask(props.summary)}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mt-2 h-9 w-full text-primary"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={linePoints(props.values)} />
    </svg>
  );
}
