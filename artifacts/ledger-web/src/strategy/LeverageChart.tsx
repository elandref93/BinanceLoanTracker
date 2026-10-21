import type { Snap } from "@/domain/leverageSim";

const WIDTH = 640;
const HEIGHT = 180;

function line(snaps: Snap[], max: number): string {
  const step = WIDTH / Math.max(1, snaps.length - 1);
  return snaps
    .map((snap, index) => {
      const y = HEIGHT - (snap.net / max) * (HEIGHT - 4);
      return `${index * step},${y}`;
    })
    .join(" ");
}

export function LeverageChart(props: { snapsA: Snap[]; snapsB: Snap[]; summary: string }) {
  if (props.snapsA.length < 2 || props.snapsB.length < 2) {
    return <p className="text-sm text-muted-foreground">{props.summary}</p>;
  }
  const max = Math.max(
    ...props.snapsA.map((snap) => snap.net),
    ...props.snapsB.map((snap) => snap.net),
    1,
  );
  return (
    <figure className="space-y-2">
      <svg
        role="img"
        aria-label={props.summary}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-44 w-full"
      >
        <polyline fill="none" stroke="#00F0FF" strokeWidth="2" points={line(props.snapsA, max)} />
        <polyline fill="none" stroke="#7c6aef" strokeWidth="2" points={line(props.snapsB, max)} />
      </svg>
      <figcaption className="text-sm text-muted-foreground">{props.summary}</figcaption>
      <p className="text-xs text-muted-foreground">
        <span className="text-primary">A: BTC + Lever</span>
        <span className="mx-2">·</span>
        <span style={{ color: "#7c6aef" }}>B: Pure AMC</span>
      </p>
    </figure>
  );
}
