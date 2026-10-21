import type { ReactNode } from "react";

/** Stroke icons drawn on a 24px grid. Inline SVG keeps them crisp and offline. */
const PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M5.5 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  portfolio: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12Z" />
      <path d="M15 3.9A8.5 8.5 0 0 1 20.1 9H15Z" />
    </>
  ),
  loans: (
    <>
      <path d="M4 9.5 12 5l8 4.5" />
      <path d="M5.5 10v7M9.5 10v7M14.5 10v7M18.5 10v7" />
      <path d="M4 19.5h16" />
    </>
  ),
  insights: (
    <>
      <path d="M4 18.5 9 13l3.5 3.5L20 8" />
      <path d="M15.5 8H20v4.5" />
      <path d="M5 4.5v2M4 5.5h2" />
    </>
  ),
  strategy: (
    <>
      <path d="M5 6.5h8M17 6.5h2M5 12h2M11 12h8M5 17.5h10M19 17.5h0" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  arrowUp: <path d="M12 18.5v-13M6.5 11 12 5.5 17.5 11" />,
  arrowDown: <path d="M12 5.5v13M6.5 13l5.5 5.5 5.5-5.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  alert: (
    <>
      <path d="M12 4 3 19.5h18Z" />
      <path d="M12 10v4.5M12 17v.01" />
    </>
  ),
  offline: (
    <>
      <path d="M3.5 9a13 13 0 0 1 17 0M6.5 12.5a8.5 8.5 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0M12 19.5v.01" />
      <path d="M4 4l16 16" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9M12 8v4.5l3 2" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  sparkle: (
    <path d="M12 4.5c.6 3.4 2.1 4.9 5.5 5.5-3.4.6-4.9 2.1-5.5 5.5-.6-3.4-2.1-4.9-5.5-5.5 3.4-.6 4.9-2.1 5.5-5.5ZM18 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" />
      <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M4.5 7.5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z" />
      <path d="M4.5 7.5 15.5 4.5v3M15.5 13.5h4" />
    </>
  ),
  bolt: <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12Z" />,
  download: (
    <>
      <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M10 7V5h4v2M6.5 7l1 12.5h9l1-12.5" />
    </>
  ),
  edit: <path d="M5 19h3.5L19 8.5 15.5 5 5 15.5Z" />,
  external: (
    <>
      <path d="M13.5 5H19v5.5M19 5l-8 8" />
      <path d="M17 13.5V19H5V7h5.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 5.5 19 19" />
      <path d="M9.5 6.8A9 9 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a16 16 0 0 1-3.2 3.6" />
      <path d="M6.2 8.2C4.2 9.6 2.5 12 2.5 12S6 17.5 12 17.5c1.2 0 2.3-.3 3.3-.8" />
      <path d="M10 10.2a2.5 2.5 0 0 0 3.4 3.4" />
    </>
  ),
  swap: <path d="M7 4.5 3.5 8 7 11.5M3.5 8h13M17 12.5l3.5 3.5-3.5 3.5M20.5 16h-13" />,
  coins: (
    <>
      <ellipse cx="9.5" cy="7.5" rx="5" ry="2.5" />
      <path d="M4.5 7.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" />
      <path d="M9.5 16.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4c0-1.2-1.6-2.2-3.8-2.4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; className?: string; strokeWidth?: number; title?: string }) {
  const size = props.size ?? 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      {PATHS[props.name]}
    </svg>
  );
}
