import { useId } from "react";

/** The Ledger mark: a rising line inside a rounded tile, matching the app icon. */
export function LedgerMark(props: { size?: number; className?: string }) {
  const size = props.size ?? 32;
  // Gradient ids must be unique: a url(#id) that resolves into a display:none copy paints nothing.
  const id = `ledger-mark${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const bg = `${id}-bg`;
  const line = `${id}-line`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={props.className}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0E1A22" />
          <stop offset="1" stopColor="#06090C" />
        </linearGradient>
        <linearGradient id={line} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#00A8C2" />
          <stop offset="1" stopColor="#00F0FF" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="15" fill={`url(#${bg})`} stroke="#1B242C" strokeWidth="2" />
      <path
        d="M14 42 L25 31 L33 37 L49 20"
        fill="none"
        stroke={`url(#${line})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="49" cy="20" r="4" fill="#00F0FF" />
    </svg>
  );
}
