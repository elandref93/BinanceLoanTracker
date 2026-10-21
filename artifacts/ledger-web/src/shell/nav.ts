import type { IconName } from "@/ui/Icon";

export type NavItem = { to: string; label: string; icon: IconName; end: boolean; shortcut: string };

/** The five main sections. Settings opens from the profile button and the sidebar footer. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: "home", end: true, shortcut: "1" },
  { to: "/portfolio", label: "Portfolio", icon: "portfolio", end: false, shortcut: "2" },
  { to: "/loans", label: "Loans", icon: "loans", end: false, shortcut: "3" },
  { to: "/insights", label: "Insights", icon: "insights", end: false, shortcut: "4" },
  { to: "/strategy", label: "Strategy", icon: "strategy", end: false, shortcut: "5" },
];

export const SETTINGS_ITEM: NavItem = { to: "/settings", label: "Settings", icon: "settings", end: false, shortcut: "," };

/** True when a keyboard shortcut should be ignored because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true;
}
