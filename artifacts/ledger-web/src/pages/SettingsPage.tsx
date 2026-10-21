import { getCredentials, useGetLtvSnapshot } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import { loadSettings, settingsSyncQueryKey } from "@/alerts/alertApi";
import {
  applySettingsEdits,
  APP_LOCK_UNAVAILABLE,
  CACHE_UNAVAILABLE,
  DEFAULT_TARGET_NOTE,
  FX_NOT_RETURNED,
  hasExchangeLink,
  keyHealthRows,
  LAST_ERROR_ABSENT,
  parseTargetLtv,
  PUSH_UNAVAILABLE,
  readProfileTarget,
  readStoredCurrency,
  readStoredTarget,
  serverRateText,
  SESSION_CONTROL,
  SETTINGS_EMPTY,
  TARGET_RANGE,
  timestampLabel,
} from "@/domain/settingsView";
import { usePrefs } from "@/prefs/PreferencesProvider";
import { Balance } from "@/prefs/DiscreetMode";
import { saveSettings, syncAccountsNow } from "@/settings/settingsApi";
import { AlertRulesSection } from "@/pages/AlertRulesPage";
import { blockedHistorySources, useImportStatus } from "@/portfolio/queries";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

type ProfileDraft = { id: string; name: string; value: string };

export function SettingsPage() {
  const queryClient = useQueryClient();
  const prefs = usePrefs();
  const settings = useQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings });
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const snapshot = useGetLtvSnapshot();
  const credentials = useQuery({ queryKey: ["credential-meta"], queryFn: () => getCredentials() });
  const [currency, setCurrency] = useState<"USD" | "ZAR" | null>(null);
  const [globalInput, setGlobalInput] = useState("");
  const [profiles, setProfiles] = useState<ProfileDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const settingsKey = settings.isSuccess ? JSON.stringify(settings.data) : null;
  const accountKey = accounts.isSuccess ? accounts.data.map((container) => container.id).join(",") : null;

  useEffect(() => {
    if (!settings.isSuccess || accounts.isPending) return;
    setCurrency(readStoredCurrency(settings.data));
    const stored = readStoredTarget(settings.data);
    setGlobalInput(stored == null ? "" : String(stored));
    setProfiles(
      (accounts.data ?? []).map((container) => {
        const target = readProfileTarget(settings.data, container.id);
        return { id: container.id, name: container.name, value: target == null ? "" : String(target) };
      }),
    );
  }, [settings.isSuccess, settings.data, settingsKey, accounts.data, accounts.isPending, accountKey]);

  const rateText = snapshot.isSuccess
    ? snapshot.data.available
      ? serverRateText(snapshot.data.snapshot ?? null)
      : FX_NOT_RETURNED
    : null;
  const health =
    credentials.isSuccess && accounts.isSuccess
      ? keyHealthRows({ containers: accounts.data, credentials: credentials.data })
      : null;
  const emptySettings =
    settings.isSuccess &&
    (settings.data == null ||
      (typeof settings.data === "object" && !Array.isArray(settings.data) && Object.keys(settings.data).length === 0));

  async function onSave(): Promise<void> {
    if (!settings.isSuccess) return;
    const globalRaw = globalInput.trim();
    const globalTarget = globalRaw === "" ? null : parseTargetLtv(globalRaw);
    if (globalRaw !== "" && globalTarget == null) {
      setMessage({ text: TARGET_RANGE, alert: true });
      return;
    }
    const profileEdits = [];
    for (const profile of profiles) {
      const raw = profile.value.trim();
      if (raw === "") {
        profileEdits.push({ id: profile.id, target: null, clear: true });
        continue;
      }
      const target = parseTargetLtv(raw);
      if (target == null) {
        setMessage({ text: `${profile.name}: ${TARGET_RANGE}`, alert: true });
        return;
      }
      profileEdits.push({ id: profile.id, target, clear: false });
    }
    setSaving(true);
    setMessage(null);
    const next = applySettingsEdits(settings.data, {
      currency,
      globalTarget,
      clearGlobal: globalRaw === "" && readStoredTarget(settings.data) != null,
      profiles: profileEdits,
    });
    next.webDiscreet = prefs.discreet;
    const result = await saveSettings(next);
    setSaving(false);
    if (result.ok) {
      await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
      setMessage({ text: "Saved. The server assigned the time.", alert: false });
      return;
    }
    if (result.conflict) {
      await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
    }
    setMessage({ text: result.message, alert: true });
  }

  async function onSync(): Promise<void> {
    if (!accounts.isSuccess) return;
    setSyncing(true);
    setSyncMessage(null);
    const result = await syncAccountsNow(accounts.data);
    setSyncing(false);
    if (!result.ok && result.conflict) {
      await queryClient.invalidateQueries({ queryKey: accountSyncQueryKey });
    }
    setSyncMessage({ text: result.message, alert: !result.ok });
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Targets and display currency are saved with your other settings. Dates and times are Africa/Johannesburg.
      </p>
      <div className="mt-4 space-y-3">
        <Card>
          <h2 className="text-sm font-medium">USD to ZAR</h2>
          {snapshot.isPending ? <p role="status" className="mt-2 text-sm text-muted-foreground">Loading the server rate…</p> : null}
          {snapshot.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              The snapshot could not be loaded. No exchange rate is shown.
            </p>
          ) : null}
          {rateText ? (
            <p className="mt-2 text-sm">
              <Balance text={rateText} />
            </p>
          ) : null}
        </Card>

        {settings.isPending ? <p role="status">Loading settings…</p> : null}
        {settings.isError ? (
          <p role="alert" className="text-sm text-danger">
            Settings could not be loaded.{" "}
            <button type="button" className="text-primary" onClick={() => void settings.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {emptySettings ? <p className="text-sm text-muted-foreground">{SETTINGS_EMPTY}</p> : null}

        {settings.isSuccess ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <Card>
              <h2 className="text-sm font-medium">Display currency</h2>
              <div className="mt-3 flex gap-2">
                {(["USD", "ZAR"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={currency === option}
                    className={
                      currency === option
                        ? "rounded-ledger bg-primary px-3 py-1 text-sm text-primary-foreground"
                        : "rounded-ledger border border-border px-3 py-1 text-sm text-muted-foreground"
                    }
                    onClick={() => setCurrency(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {currency == null ? (
                <p className="mt-2 text-sm text-muted-foreground">Display currency is not saved yet.</p>
              ) : null}
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="text-sm font-medium">Discreet mode</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Hide balances until the pointer is over one of them. Names, dates, and the person switcher stay visible.
                </p>
                <button
                  type="button"
                  aria-pressed={prefs.discreet}
                  className={
                    prefs.discreet
                      ? "mt-3 rounded-ledger bg-primary px-3 py-1 text-sm text-primary-foreground"
                      : "mt-3 rounded-ledger border border-border px-3 py-1 text-sm text-muted-foreground"
                  }
                  onClick={() => prefs.setDiscreet(!prefs.discreet)}
                >
                  {prefs.discreet ? "On" : "Off"}
                </button>
              </div>
            </Card>
            <Card>
              <h2 className="text-sm font-medium">Target LTV</h2>
              <p className="mt-2 text-sm text-muted-foreground">{DEFAULT_TARGET_NOTE}</p>
              <label className="mt-3 block text-sm text-muted-foreground" htmlFor="target-ltv">
                Default for every profile
              </label>
              <input
                id="target-ltv"
                inputMode="decimal"
                value={globalInput}
                onChange={(event) => setGlobalInput(event.target.value)}
                className="mt-2 w-32 rounded-ledger border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <h3 className="mt-4 text-sm font-medium">Per profile</h3>
              {accounts.isPending ? <p role="status" className="mt-2 text-sm">Loading profiles…</p> : null}
              {accounts.isError ? (
                <p role="alert" className="mt-2 text-sm text-danger">
                  Profiles could not be loaded, so per-profile targets stay as they are.
                </p>
              ) : null}
              {accounts.isSuccess && profiles.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No profiles yet.</p>
              ) : null}
              <ul className="mt-2 space-y-3">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <label className="block text-sm text-muted-foreground" htmlFor={`target-${profile.id}`}>
                      {profile.name}
                    </label>
                    <input
                      id={`target-${profile.id}`}
                      inputMode="decimal"
                      value={profile.value}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProfiles((current) =>
                          current.map((item) => (item.id === profile.id ? { ...item, value } : item)),
                        );
                      }}
                      className="mt-1 w-32 rounded-ledger border border-border bg-background px-3 py-2 text-sm"
                      autoComplete="off"
                    />
                  </li>
                ))}
              </ul>
              <button
                type="submit"
                className="mt-4 rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                disabled={saving || settings.isPending}
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </Card>
          </form>
        ) : null}
        {message ? (
          <p role={message.alert ? "alert" : "status"} className={message.alert ? "text-sm text-danger" : "text-sm"}>
            {message.text}
          </p>
        ) : null}

        <Card>
          <h2 className="text-sm font-medium">Cross-device sync</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Uploads the account list already stored for this session. The server assigns the time.
          </p>
          <button
            type="button"
            className="mt-3 rounded-ledger border border-border px-4 py-2 text-sm disabled:opacity-40"
            disabled={syncing || !accounts.isSuccess}
            onClick={() => void onSync()}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {accounts.isSuccess && !hasExchangeLink(accounts.data) ? (
            <p className="mt-2 text-sm text-muted-foreground">No exchange links yet.</p>
          ) : null}
          {syncMessage ? (
            <p role={syncMessage.alert ? "alert" : "status"} className={syncMessage.alert ? "mt-2 text-sm text-danger" : "mt-2 text-sm"}>
              {syncMessage.text}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-sm font-medium">Key health</h2>
          {credentials.isPending ? <p role="status" className="mt-2 text-sm">Loading key status…</p> : null}
          {credentials.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              Key health could not be loaded.
            </p>
          ) : null}
          {health ? <p className="mt-2 text-sm text-muted-foreground">{health.note}</p> : null}
          {credentials.isSuccess ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {timestampLabel(credentials.data.updatedAt)
                ? `Credential record ${timestampLabel(credentials.data.updatedAt)}.`
                : "No credential time was returned."}
            </p>
          ) : null}
          {health && health.rows.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm">
              {health.rows.map((row) => (
                <li key={`${row.exchange}:${row.linkId}`}>
                  <span>
                    {row.profile} · {row.exchange === "binance" ? "Binance" : row.exchange === "luno" ? "Luno" : row.exchange}
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    {row.presence === "present" ? "Present" : "Missing"}
                    {". "}
                    {row.lastError ?? LAST_ERROR_ABSENT}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-sm font-medium">This browser</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>{PUSH_UNAVAILABLE}</li>
            <li>{APP_LOCK_UNAVAILABLE}</li>
            <li>{CACHE_UNAVAILABLE}</li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-medium">Session</h2>
          <p className="mt-2 text-sm text-muted-foreground">{SESSION_CONTROL}</p>
          <p className="mt-2 text-sm">
            <Link className="text-primary" to="/settings/diagnostics">
              Diagnostics
            </Link>
          </p>
        </Card>

        <ImportStatusCard />

        <Card>
          <h2 className="text-sm font-medium">Accounts</h2>
          <p className="mt-2 text-sm text-muted-foreground">Profiles and exchange links. Keys stay encrypted on the server.</p>
          <p className="mt-2 text-sm">
            <Link className="text-primary" to="/settings/accounts">
              Manage accounts
            </Link>
          </p>
        </Card>

        <AlertRulesSection />
      </div>
    </section>
  );
}

function ImportStatusCard() {
  const status = useImportStatus();
  const data = status.data;
  const blocked = blockedHistorySources(data?.sources);
  return (
    <Card>
      <h2 className="text-sm font-medium">History import</h2>
      {status.isPending ? <p role="status" className="mt-2 text-sm text-muted-foreground">Checking the ledger import…</p> : null}
      {status.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Import status could not be loaded.
        </p>
      ) : null}
      {data ? (
        <div className="mt-2 text-sm">
          <p>
            {data.state === "complete"
              ? "History is up to date."
              : data.state === "running" || data.state === "pending" || data.state === "partial"
                ? `Building history… ${Math.round(data.progress * 100)}%`
                : data.state === "error"
                  ? "The last import stopped with an error."
                  : "History has not been imported yet."}
          </p>
          <p className="mt-1 text-muted-foreground">
            {data.eventCount} events
            {data.reconciliation.length > 0 ? ` · ${data.reconciliation.length} unreconciled` : ""}
          </p>
          {blocked.length > 0 ? <p className="mt-1 text-muted-foreground">Could not import {blocked.join(", ")}.</p> : null}
          {data.notes.length > 0 ? <p className="mt-1 text-muted-foreground">{data.notes[0]}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
