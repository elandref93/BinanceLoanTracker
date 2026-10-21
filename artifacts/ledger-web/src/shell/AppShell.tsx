import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { fmtAge } from "@/domain/format";
import { personChoices, scopeChoices, userPersonTitle } from "@/prefs/preferences";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { useBrowserSession } from "@/session/SessionProvider";
import { isTypingTarget, NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "@/shell/nav";
import { useRefresh } from "@/shell/RefreshProvider";
import { usePullToRefresh } from "@/shell/usePullToRefresh";
import { Icon } from "@/ui/Icon";
import { withViewTransition } from "@/ui/motion";
import { cx, IconButton, Notice, ProfileBadge, Segmented } from "@/ui/primitives";
import { Sheet } from "@/ui/Sheet";

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Re-renders every 30 seconds so relative times stay honest. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The signed-in frame. Under 640px: top bar plus a bottom tab bar. From 640px
 * (iPad portrait, iPhone landscape): a 72px icon rail. From 1024px (iPad Pro,
 * desktop): a 240px sidebar with labels. Safe-area insets are honoured on
 * every edge so nothing hides behind the notch or home indicator.
 */
export function AppShell(): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useBrowserSession();
  const { refresh } = useRefresh();
  const online = useOnline();
  const updateReady = useAppUpdate();
  const pull = usePullToRefresh(refresh);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;
      const item = NAV_ITEMS.find((candidate) => candidate.shortcut === event.key);
      if (item) {
        event.preventDefault();
        withViewTransition(() => navigate(item.to));
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void refresh();
      } else if (event.key === ",") {
        event.preventDefault();
        navigate(SETTINGS_ITEM.to);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, refresh]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-ledger focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SideNav />
      <div className="min-w-0 sm:pl-[calc(72px+env(safe-area-inset-left))] lg:pl-[calc(240px+env(safe-area-inset-left))]">
        <TopBar />
        <PullIndicator pull={pull.pull} armed={pull.armed} busy={pull.busy} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-[1480px] overflow-x-clip pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] outline-none sm:pb-12 sm:pt-5 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]"
          style={pull.pull > 0 ? { transform: `translateY(${pull.pull * 0.6}px)` } : undefined}
        >
          {updateReady ? (
            <Notice
              tone="info"
              title="New version, reload"
              className="mb-4"
              action={
                <button type="button" className="min-h-9 rounded-ledger bg-primary px-3 text-caption font-semibold text-primary-foreground" onClick={() => window.location.reload()}>
                  Reload
                </button>
              }
            >
              A newer Ledger is ready. Reloading picks it up.
            </Notice>
          ) : null}
          {!online ? (
            <Notice tone="offline" title="You're offline" className="mb-4">
              Figures on screen are from your last visit and will refresh when you reconnect.
            </Notice>
          ) : !session.reachable ? (
            <Notice tone="offline" title="Can't reach Ledger" className="mb-4">
              Retrying automatically. Figures on screen may be out of date.
            </Notice>
          ) : null}
          <Suspense fallback={<RouteLoading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TabBar />
    </div>
  );
}

function useAppUpdate(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const watch = (worker: ServiceWorker | null) => {
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) setReady(true);
      });
    };
    void navigator.serviceWorker.getRegistration().then((current) => {
      if (!current) return;
      if (current.waiting && navigator.serviceWorker.controller) setReady(true);
      watch(current.installing);
      current.addEventListener("updatefound", () => watch(current.installing));
    });
  }, []);
  return ready;
}

function RouteLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-fade-in [animation-delay:150ms]">
      <span className="block h-8 w-40 rounded-lg skeleton" />
      <span className="mt-2 block h-4 w-64 rounded skeleton" />
      <span className="mt-5 block h-72 rounded-ledger skeleton" />
    </div>
  );
}

function SideNav() {
  return (
    <aside
      aria-label="Sections"
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-background pl-safe pt-safe pb-safe sm:flex sm:w-[calc(72px+env(safe-area-inset-left))] lg:w-[calc(240px+env(safe-area-inset-left))]"
    >
      <div className="flex h-16 items-center justify-center gap-2.5 lg:justify-start lg:px-5">
        <span className="hidden text-heading font-semibold tracking-tight lg:inline">Ledger</span>
      </div>
      <nav aria-label="Primary" className="mt-2 flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => (
          <SideLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="px-3 pb-4">
        <SideLink item={SETTINGS_ITEM} />
      </div>
    </aside>
  );
}

function SideLink(props: { item: NavItem }) {
  const { item } = props;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      viewTransition
      title={`${item.label} (${item.shortcut})`}
      className={({ isActive }) =>
        cx(
          "group relative flex h-11 items-center justify-center gap-3 rounded-xl text-body font-medium transition-colors lg:justify-start lg:px-3",
          isActive ? "bg-card-elevated text-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cx(
              "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary transition-opacity duration-200",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <Icon name={item.icon} size={21} className={isActive ? "text-primary" : undefined} />
          <span className="sr-only lg:not-sr-only">{item.label}</span>
          <kbd className="ml-auto hidden rounded border border-border px-1.5 text-micro text-subtle opacity-0 transition-opacity group-hover:opacity-100 lg:inline">
            {item.shortcut}
          </kbd>
        </>
      )}
    </NavLink>
  );
}

function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 pb-safe backdrop-blur-xl backdrop-saturate-150 sm:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              viewTransition
              className={({ isActive }) =>
                cx(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors active:scale-95",
                  isActive ? "text-primary" : "text-subtle",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={23} strokeWidth={isActive ? 2.1 : 1.8} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TopBar() {
  const navigate = useNavigate();
  const session = useBrowserSession();
  const prefs = usePrefs();
  const { refresh, refreshing, asOf } = useRefresh();
  const now = useNow();
  const [scopeOpen, setScopeOpen] = useState(false);
  const choices = scopeChoices(prefs.containers);
  const selected = choices.find((choice) => choice.id === prefs.scope) ?? choices[0];
  const showScope = prefs.person === "user" && choices.length > 1;
  const ageMinutes = asOf ? (now - Date.parse(asOf)) / 60_000 : null;
  const stale = ageMinutes != null && ageMinutes > 30;
  const people = personChoices(userPersonTitle(session.user?.name));

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 pt-safe backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 w-full min-w-0 max-w-[1480px] items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:h-16 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]">
        {showScope ? (
          <button
            type="button"
            onClick={() => setScopeOpen(true)}
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-caption font-semibold text-foreground transition-colors hover:border-border-strong"
            aria-label={`Showing ${selected?.title ?? "All profiles"}. Change profile`}
          >
            {selected?.type ? <ProfileBadge type={selected.type} /> : <Icon name="wallet" size={16} className="text-muted-foreground" />}
            <span className="truncate">{selected?.title ?? "All profiles"}</span>
            <Icon name="chevronDown" size={14} className="shrink-0 text-muted-foreground" />
          </button>
        ) : prefs.person === "user" ? (
          <span className="hidden text-caption text-muted-foreground sm:inline">{selected?.title ?? "All profiles"}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Segmented
            label="Display currency"
            size="sm"
            value={prefs.currency}
            onChange={(value) => prefs.setCurrency(value)}
            options={[
              { value: "ZAR", label: "ZAR" },
              { value: "USD", label: "USD" },
            ]}
            className="w-[104px]"
          />
          <button
            type="button"
            aria-pressed={prefs.discreet}
            aria-label={prefs.discreet ? "Discreet mode on. Show balances" : "Discreet mode off. Hide balances"}
            title={prefs.discreet ? "Discreet mode on" : "Discreet mode off"}
            onClick={() => prefs.setDiscreet(!prefs.discreet)}
            className={cx(
              "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-card sm:border sm:border-border",
              prefs.discreet ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon name={prefs.discreet ? "eyeOff" : "eye"} size={18} />
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={asOf ? `Updated ${fmtAge(asOf, now)}. Refresh` : "Refresh"}
            title="Refresh (R)"
            className={cx(
              "flex min-h-11 items-center gap-2 rounded-full px-2.5 text-caption transition-colors hover:bg-card sm:border sm:border-border sm:px-3",
              stale ? "text-warn" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cx("hidden size-1.5 rounded-full sm:inline-block", stale ? "bg-warn" : refreshing ? "bg-primary animate-pulse" : "bg-ok")}
            />
            <span className="hidden whitespace-nowrap md:inline">{asOf ? `Updated ${fmtAge(asOf, now)}` : "Refresh"}</span>
            <Icon name="refresh" size={18} className={refreshing ? "animate-spin-slow" : undefined} />
          </button>
          <IconButton icon="user" label="Settings" onClick={() => navigate("/settings")} className="lg:hidden" />
        </div>
      </div>
      <PersonSwitcher people={people} />
      {prefs.saveError ? <p className="px-4 pb-2 text-micro text-warn">{prefs.saveError}</p> : null}
      <ScopeSheet open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </header>
  );
}

function PersonSwitcher(props: { people: ReturnType<typeof personChoices> }) {
  const prefs = usePrefs();
  return (
    <div
      role="radiogroup"
      aria-label="Person"
      className="mx-auto flex w-full min-w-0 max-w-[1480px] items-center gap-1 overflow-x-auto pb-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] [-ms-overflow-style:none] [scrollbar-width:none] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))] [&::-webkit-scrollbar]:hidden"
    >
      {props.people.map((person) => {
        const selected = person.id === prefs.person;
        return (
          <button
            key={person.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={person.caption}
            onClick={() => prefs.setPerson(person.id)}
            className={cx(
              "min-h-9 shrink-0 rounded-full px-2.5 text-caption font-semibold transition-colors sm:min-h-10 sm:px-3",
              selected ? "bg-card-elevated text-foreground shadow-[inset_0_0_0_1px_var(--color-border-strong)]" : "text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            {person.title}
          </button>
        );
      })}
    </div>
  );
}

function ScopeSheet(props: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const options = scopeChoices(prefs.containers);
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Show figures for" size="sm">
      <ul className="-mx-2 flex flex-col" role="radiogroup" aria-label="Profile">
        {options.map((option) => {
          const selected = option.id === prefs.scope;
          return (
            <li key={option.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                data-autofocus={selected ? "" : undefined}
                onClick={() => {
                  prefs.setScope(option.id);
                  props.onClose();
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-card-elevated"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-body font-semibold">
                    {option.title}
                    {option.type ? <ProfileBadge type={option.type} /> : null}
                  </span>
                  {option.caption ? <span className="block text-caption text-muted-foreground">{option.caption}</span> : null}
                </span>
                {selected ? <Icon name="check" size={18} className="text-primary" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function PullIndicator(props: { pull: number; armed: boolean; busy: boolean }) {
  if (props.pull <= 0 && !props.busy) return null;
  const progress = Math.min(1, props.pull / 72);
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 z-10 flex justify-center sm:hidden" style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}>
      <span
        className="flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-lg"
        style={{ opacity: props.busy ? 1 : progress, transform: `rotate(${progress * 270}deg) scale(${0.6 + progress * 0.4})` }}
      >
        <Icon name="refresh" size={18} className={cx(props.armed || props.busy ? "text-primary" : "text-muted-foreground", props.busy ? "animate-spin-slow" : "")} />
      </span>
    </div>
  );
}
