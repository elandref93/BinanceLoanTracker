import { getGetLtvSnapshotQueryKey, getLtvSnapshot } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Balance, DiscreetProvider } from "@/prefs/DiscreetMode";
import { readDiscreetCache, readStoredDiscreet, writeDiscreetCache } from "@/prefs/discreet";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import type { SyncContainer } from "@/accounts/accountModel";
import { loadSettings, settingsSyncQueryKey } from "@/alerts/alertApi";
import { snapshotFx } from "@/domain/portfolio";
import {
  applyPreferenceEdit,
  CHILD_SCOPE_PROFILES,
  readStoredPerson,
  readStoredScope,
  resolvePerson,
  resolveScope,
  selectPerson,
  shortProfileName,
  type DisplayCurrency,
  type PersonId,
  type ScopeId,
} from "@/prefs/preferences";
import { readStoredCurrency } from "@/domain/settingsView";
import { fmtCompact, fmtDisplayMoney, fmtSignedMoney } from "@/domain/format";
import { saveSettings } from "@/settings/settingsApi";
import { useBrowserSession } from "@/session/SessionProvider";

export type MoneyOptions = { whole?: boolean; compact?: boolean; signed?: boolean };

type PreferenceEdit = { currency?: DisplayCurrency; scope?: ScopeId; person?: PersonId; discreet?: boolean };

type PreferencesValue = {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
  /** Hide balances until the pointer is over one of them. Off until the user turns it on. */
  discreet: boolean;
  setDiscreet: (on: boolean) => void;
  /** Formatted amount as text, for sentences and accessible names. */
  formatMoney: (usd: number | null | undefined, opts?: MoneyOptions) => string;
  /** Who the figures are for. Children are not a cut of the user's profiles. */
  person: PersonId;
  setPerson: (person: PersonId) => void;
  /** Optional cut of the user's own profiles. Ignored while a child is selected. */
  scope: ScopeId;
  setScope: (scope: ScopeId) => void;
  containers: SyncContainer[];
  containersLoaded: boolean;
  /** USD to ZAR from the server; null when no rate was returned. */
  fx: number | null;
  reportFx: (rate: number | null | undefined) => void;
  /** Formats a USD amount in the display currency. Masked while discreet mode is hiding figures. */
  /** Converts a USD amount into the display currency, or null when ZAR has no rate. */
  convert: (usd: number) => number | null;
  saveError: string | null;
  money: (usd: number | null | undefined, opts?: MoneyOptions) => ReactNode;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider(props: { children: ReactNode }) {
  const session = useBrowserSession();
  const queryClient = useQueryClient();
  const signedIn = session.user != null;
  const settings = useQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings, enabled: signedIn, staleTime: 5 * 60_000 });
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync, enabled: signedIn, staleTime: 5 * 60_000 });
  const snapshot = useQuery({
    queryKey: getGetLtvSnapshotQueryKey(),
    queryFn: () => getLtvSnapshot(),
    enabled: signedIn,
    staleTime: 60_000,
  });
  const [localCurrency, setLocalCurrency] = useState<DisplayCurrency | null>(null);
  const [localPerson, setLocalPerson] = useState<PersonId | null>(null);
  const [localScope, setLocalScope] = useState<ScopeId | null>(null);
  const [localDiscreet, setLocalDiscreet] = useState<boolean | null>(null);
  const cachedDiscreet = useRef(readDiscreetCache());
  const [reportedFx, setReportedFx] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingEdit = useRef<PreferenceEdit>({});

  const containers = useMemo(() => accounts.data ?? [], [accounts.data]);
  const storedCurrency = settings.isSuccess ? readStoredCurrency(settings.data) : null;
  const storedScope = settings.isSuccess ? readStoredScope(settings.data) : null;
  const storedPerson = settings.isSuccess ? readStoredPerson(settings.data) : null;
  const storedDiscreet = settings.isSuccess ? readStoredDiscreet(settings.data) : null;
  const currency: DisplayCurrency = localCurrency ?? storedCurrency ?? "ZAR";
  const person = localPerson ?? resolvePerson(storedPerson, storedScope);
  const scope = resolveScope(localScope ?? storedScope, containers);
  const discreet = localDiscreet ?? storedDiscreet ?? cachedDiscreet.current ?? false;

  const snapshotRate = snapshot.data && "snapshot" in snapshot.data ? snapshotFx(snapshot.data.snapshot?.fxUsdToZar) : null;
  const fx = reportedFx ?? snapshotRate;

  const flush = useCallback(async () => {
    const edit = pendingEdit.current;
    pendingEdit.current = {};
    const current = await queryClient.fetchQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings, staleTime: 0 });
    const result = await saveSettings(applyPreferenceEdit(current, edit));
    if (result.ok) {
      setSaveError(null);
      await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
      return;
    }
    setSaveError(result.conflict ? null : "Display preferences could not be saved. They apply to this visit only.");
    if (result.conflict) {
      // Another device wrote first: reload and apply this edit on top once.
      const fresh = await queryClient.fetchQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings, staleTime: 0 });
      const retry = await saveSettings(applyPreferenceEdit(fresh, edit));
      if (!retry.ok) setSaveError("Display preferences could not be saved. They apply to this visit only.");
      await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
    }
  }, [queryClient]);

  const schedule = useCallback(
    (edit: PreferenceEdit) => {
      pendingEdit.current = { ...pendingEdit.current, ...edit };
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flush();
      }, 600);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (localDiscreet == null && !settings.isSuccess) return;
    writeDiscreetCache(discreet);
  }, [discreet, localDiscreet, settings.isSuccess]);

  const value = useMemo<PreferencesValue>(() => {
    const convert = (usd: number): number | null => {
      if (!Number.isFinite(usd)) return null;
      if (currency === "USD") return usd;
      return fx == null ? null : usd * fx;
    };
    const formatMoney = (usd: number | null | undefined, opts: MoneyOptions = {}): string => {
      if (usd == null || !Number.isFinite(usd)) return "—";
      const converted = convert(usd);
      if (converted == null) return "—";
      if (opts.signed) return fmtSignedMoney(converted, currency, opts);
      if (opts.compact) return fmtCompact(converted, currency === "USD" ? "$" : "R");
      return fmtDisplayMoney(converted, currency, opts);
    };
    const money = (usd: number | null | undefined, opts?: MoneyOptions): ReactNode => <Balance text={formatMoney(usd, opts)} />;
    return {
      currency,
      setCurrency: (next) => {
        setLocalCurrency(next);
        schedule({ currency: next });
      },
      discreet,
      setDiscreet: (next) => {
        setLocalDiscreet(next);
        schedule({ discreet: next });
      },
      formatMoney,
      person,
      setPerson: (next) => {
        const selected = selectPerson({ person, scope }, next);
        setLocalPerson(selected.person);
        if (selected.scope !== scope) setLocalScope(selected.scope);
        schedule(selected.scope !== scope ? { person: selected.person, scope: selected.scope } : { person: selected.person });
      },
      scope,
      setScope: (next) => {
        if (next !== "all" && !containers.some((container) => container.id === next)) return;
        setLocalPerson("user");
        setLocalScope(next);
        schedule({ person: "user", scope: next });
      },
      containers,
      containersLoaded: accounts.isSuccess,
      fx,
      reportFx: (rate) => {
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
          setReportedFx((prev) => (prev === rate ? prev : rate));
        }
      },
      money,
      convert,
      saveError,
    };
  }, [accounts.isSuccess, containers, currency, discreet, fx, person, saveError, schedule, scope]);

  return (
    <PreferencesContext.Provider value={value}>
      <DiscreetProvider enabled={discreet}>{props.children}</DiscreetProvider>
    </PreferencesContext.Provider>
  );
}

export function usePrefs(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("Preferences are unavailable");
  return value;
}

/** Display name for a profile id from the server; "none" is accounts outside any profile. */
export function useProfileName(): (containerId: string) => string {
  const { containers } = usePrefs();
  return useCallback(
    (containerId: string) => {
      if (containerId === "none") return "Not in a profile";
      const child = CHILD_SCOPE_PROFILES.find((profile) => profile.id === containerId);
      if (child) return child.name;
      const container = containers.find((item) => item.id === containerId);
      return container ? shortProfileName(container) : "Profile";
    },
    [containers],
  );
}

/** Account link ids in the current user profile, or null for the user's combined view. A child has none of these links. */
export function useScopeLinkIds(): Set<string> | null {
  const { person, scope, containers } = usePrefs();
  return useMemo(() => {
    if (person !== "user") return new Set();
    if (scope === "all") return null;
    const container = containers.find((item) => item.id === scope);
    return new Set(container?.links.map((link) => link.id) ?? []);
  }, [containers, person, scope]);
}
