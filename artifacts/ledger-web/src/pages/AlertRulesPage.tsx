import { useGetLtvSnapshot, useListLoans, type Loan, type SnapshotLoan } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { loadSettings, removeAlertRule, saveAlertRule, settingsSyncQueryKey } from "@/alerts/alertApi";
import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import type { SyncContainer } from "@/accounts/accountModel";
import {
  ALERT_DELIVERY_UNAVAILABLE,
  alertLoan,
  chooseAlertLoans,
  containerIdByAccountId,
  describeScope,
  evaluateAlertTriggers,
  isContainerScope,
  isLoanScope,
  makeRuleId,
  parseLtvInput,
  rulesFromSettings,
  type AlertLoan,
  type AlertRule,
  type AlertScope,
} from "@/domain/alertRules";
import { fmtPct } from "@/domain/format";
import { Sheet } from "@/ui/Sheet";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

function mapLive(loans: Loan[]): AlertLoan[] {
  return loans.flatMap((item) => {
    const parsed = alertLoan({
      id: item.id,
      accountId: item.accountId,
      ltv: item.ltv,
      asset: item.asset,
      collateralAsset: item.collateral.asset,
    });
    return parsed ? [parsed] : [];
  });
}

function mapSnapshot(loans: SnapshotLoan[]): AlertLoan[] {
  return loans.flatMap((item) => {
    const parsed = alertLoan({
      id: item.id,
      accountId: item.accountId,
      ltv: item.ltv,
      asset: item.asset,
      collateralAsset: item.collateralAsset,
    });
    return parsed ? [parsed] : [];
  });
}

function useAlertData() {
  const settings = useQuery({ queryKey: settingsSyncQueryKey, queryFn: loadSettings });
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const live = useListLoans();
  const snapshot = useGetLtvSnapshot();
  const rules = useMemo(() => rulesFromSettings(settings.data), [settings.data]);
  const containers = accounts.data ?? [];
  const containerByAccount = useMemo(() => containerIdByAccountId(containers), [containers]);
  const source = chooseAlertLoans({
    livePending: live.isPending,
    liveFailed: live.isError,
    liveLoans: live.isSuccess ? mapLive(live.data.loans) : null,
    snapshotPending: snapshot.isPending,
    snapshotFailed: snapshot.isError,
    snapshotLoans:
      snapshot.isSuccess && snapshot.data.available && snapshot.data.snapshot
        ? mapSnapshot(snapshot.data.snapshot.loans ?? [])
        : snapshot.isSuccess
          ? null
          : null,
  });
  const matches = source.status === "ready" ? evaluateAlertTriggers(rules, source.loans, containerByAccount) : [];
  return { settings, accounts, rules, containers, containerByAccount, source, matches };
}

function loanLabel(loans: readonly AlertLoan[], loanId: string): string | null {
  const loan = loans.find((item) => item.id === loanId);
  return loan ? `${loan.collateralAsset}/${loan.asset}` : null;
}

function containerLabel(containers: readonly SyncContainer[], containerId: string): string | null {
  return containers.find((item) => item.id === containerId)?.name ?? null;
}

function idleTriggerLine(loanCount: number): string {
  if (loanCount === 0) return "No loans to compare.";
  return "Not triggered.";
}

export function AlertRulesSection() {
  const data = useAlertData();
  const loans = data.source.status === "ready" ? data.source.loans : [];

  return (
    <div className="space-y-3 text-sm text-foreground">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-medium">LTV alert rules</h2>
        <Link className="rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" to="/settings/alerts/new">
          Add alert rule
        </Link>
      </div>
      <p className="text-muted-foreground">{ALERT_DELIVERY_UNAVAILABLE}</p>
      {data.source.status === "pending" ? <p role="status">Checking loan LTV…</p> : null}
      {data.source.status === "unavailable" ? (
        <p>Trigger state is unavailable until a loan LTV is loaded.</p>
      ) : null}
      {data.source.status === "ready" && data.source.source === "snapshot" ? (
        <p className="text-muted-foreground">Using the saved snapshot.</p>
      ) : null}
      {data.settings.isPending ? <p role="status">Loading alert rules…</p> : null}
      {data.settings.isError ? (
        <p role="alert" className="text-danger">
          Alert rules could not be loaded.{" "}
          <button type="button" className="text-primary" onClick={() => void data.settings.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      {data.settings.isSuccess && data.rules.length === 0 ? (
        <Card>
          <p>No alert rules yet.</p>
        </Card>
      ) : null}
      {data.rules.map((rule) => {
        const ruleMatches = data.matches.filter((match) => match.ruleId === rule.id);
        return (
          <Card key={rule.id}>
            <div className="flex items-baseline justify-between gap-3">
              <Link className="font-medium text-primary" to={`/settings/alerts/${encodeURIComponent(rule.id)}`}>
                {rule.label ? `${rule.label} · ${fmtPct(rule.ltv)}` : fmtPct(rule.ltv)}
              </Link>
              <span className="text-muted-foreground">
                {describeScope(
                  rule,
                  (loanId) => loanLabel(loans, loanId),
                  (containerId) => containerLabel(data.containers, containerId),
                )}
              </span>
            </div>
            {data.source.status === "ready" ? (
              <div className="mt-2">
                <p>{ruleMatches.length === 0 ? idleTriggerLine(loans.length) : "Triggered."}</p>
                {ruleMatches.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {ruleMatches.map((match) => (
                      <li key={match.loanId}>
                        <Link className="text-primary" to={`/loans/${encodeURIComponent(match.loanId)}`}>
                          {match.pair}
                        </Link>
                        {` at ${fmtPct(match.ltv)}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

function initialScope(loanId: string | null, containerId: string | null): AlertScope {
  if (loanId) return { loanId };
  if (containerId) return { containerId };
  return "any";
}

export function AlertRuleEditorPage() {
  const { ruleId: routeId } = useParams();
  const [params] = useSearchParams();
  const isNew = routeId == null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const data = useAlertData();
  const stored = data.rules.find((rule) => rule.id === routeId) ?? null;
  const [createdId] = useState(() => makeRuleId());
  const [ltvStr, setLtvStr] = useState("70");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<AlertScope>(() =>
    initialScope(params.get("loanId"), params.get("containerId")),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(isNew);
  const loans = data.source.status === "ready" ? data.source.loans : [];
  const parsedLtv = parseLtvInput(ltvStr);
  const valid = parsedLtv != null;

  useEffect(() => {
    if (isNew || !stored) return;
    setLtvStr(String(stored.ltv));
    setLabel(stored.label ?? "");
    setScope(stored.scope);
    setHydrated(true);
  }, [isNew, stored]);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: settingsSyncQueryKey });
  }

  async function onSave(): Promise<void> {
    if (parsedLtv == null) {
      setMessage("Enter an LTV above 0 and below 100.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const rule: AlertRule = {
      id: isNew ? createdId : (routeId ?? createdId),
      ltv: parsedLtv,
      scope,
      ...(label.trim() ? { label: label.trim() } : {}),
    };
    const result = await saveAlertRule(rule);
    setSaving(false);
    if (result.ok) {
      await reload();
      navigate("/settings", { replace: true });
      return;
    }
    if (result.conflict) {
      await reload();
      setMessage("These rules were updated somewhere else. The saved copy was reloaded.");
      return;
    }
    setMessage(result.message);
  }

  async function onDelete(): Promise<void> {
    if (!routeId) return;
    setSaving(true);
    setMessage(null);
    const result = await removeAlertRule(routeId);
    setSaving(false);
    if (result.ok) {
      await reload();
      navigate("/settings", { replace: true });
      return;
    }
    if (result.conflict) {
      await reload();
      setMessage("These rules were updated somewhere else. The saved copy was reloaded.");
      return;
    }
    setMessage(result.message);
  }

  const missing = !isNew && data.settings.isSuccess && stored == null;
  const selectedMissingContainer =
    isContainerScope(scope) && !data.containers.some((item) => item.id === scope.containerId);
  const selectedMissingLoan = isLoanScope(scope) && !loans.some((item) => item.id === scope.loanId);

  return (
    <Sheet
      open
      size="lg"
      title={isNew ? "New alert" : "Edit alert"}
      description={ALERT_DELIVERY_UNAVAILABLE}
      onClose={() => navigate("/settings")}
    >
      <div className="space-y-3">
        {data.settings.isPending ? <p role="status">Loading alert rules…</p> : null}
        {data.settings.isError ? (
          <p role="alert" className="text-sm text-danger">
            Alert rules could not be loaded.{" "}
            <button type="button" className="text-primary" onClick={() => void data.settings.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {missing ? (
          <Card>
            <p>This alert rule is not on your account.</p>
          </Card>
        ) : null}
        {data.settings.isSuccess && !missing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <Card>
              <label className="block text-xs font-medium tracking-wide text-muted-foreground uppercase" htmlFor="alert-ltv">
                Trigger when LTV reaches
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="alert-ltv"
                  inputMode="decimal"
                  autoComplete="off"
                  value={ltvStr}
                  aria-invalid={!valid}
                  onChange={(event) => setLtvStr(event.target.value)}
                  className="w-full rounded-ledger border border-border bg-background px-3 py-2 text-3xl font-semibold"
                />
                <span className="text-2xl text-muted-foreground">%</span>
              </div>
            </Card>
            <Card>
              <label className="block text-xs font-medium tracking-wide text-muted-foreground uppercase" htmlFor="alert-label">
                Label (optional)
              </label>
              <input
                id="alert-label"
                value={label}
                autoComplete="off"
                placeholder="e.g. Margin call"
                onChange={(event) => setLabel(event.target.value)}
                className="mt-2 w-full rounded-ledger border border-border bg-background px-3 py-2 text-sm"
              />
            </Card>
            <Card>
              <fieldset>
                <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Applies to</legend>
                <div className="mt-2 divide-y divide-border">
                  <ScopeOption
                    value="any"
                    label="Any loan"
                    hint="Fires on every loan that reaches the threshold"
                    checked={scope === "any"}
                    onSelect={() => setScope("any")}
                  />
                  {data.containers.map((container) => (
                    <ScopeOption
                      key={container.id}
                      value={`container:${container.id}`}
                      label={`${container.name} account`}
                      hint="Fires on any loan in this account"
                      checked={isContainerScope(scope) && scope.containerId === container.id}
                      onSelect={() => setScope({ containerId: container.id })}
                    />
                  ))}
                  {selectedMissingContainer && isContainerScope(scope) ? (
                    <ScopeOption
                      value={`container:${scope.containerId}`}
                      label="1 account"
                      hint="This account is not in the synced list"
                      checked
                      onSelect={() => setScope(scope)}
                    />
                  ) : null}
                  {loans.map((loan) => {
                    const containerId = data.containerByAccount.get(loan.accountId);
                    const account = containerId ? containerLabel(data.containers, containerId) : null;
                    return (
                      <ScopeOption
                        key={loan.id}
                        value={`loan:${loan.id}`}
                        label={`${loan.collateralAsset}/${loan.asset}`}
                        hint={`${account ?? "Account"} · current ${fmtPct(loan.ltv)}`}
                        checked={isLoanScope(scope) && scope.loanId === loan.id}
                        onSelect={() => setScope({ loanId: loan.id })}
                      />
                    );
                  })}
                  {selectedMissingLoan && isLoanScope(scope) ? (
                    <ScopeOption
                      value={`loan:${scope.loanId}`}
                      label="1 loan"
                      hint="This loan is not in the current list"
                      checked
                      onSelect={() => setScope(scope)}
                    />
                  ) : null}
                </div>
              </fieldset>
              {data.accounts.isError ? <p className="mt-2 text-sm text-danger">Accounts could not be loaded.</p> : null}
              {data.source.status === "unavailable" ? (
                <p className="mt-2 text-sm text-muted-foreground">Individual loans appear when a loan LTV is loaded.</p>
              ) : null}
            </Card>
            <button
              type="submit"
              disabled={!valid || saving || !hydrated || data.settings.isPending}
              className="w-full rounded-ledger bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {saving ? "Saving…" : isNew ? "Create alert" : "Save changes"}
            </button>
          </form>
        ) : null}
        {!isNew && stored ? (
          <Card>
            {confirmDelete ? (
              <div>
                <p>Delete this alert rule? It is removed from your account.</p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    className="rounded-ledger border border-danger px-4 py-2 text-sm text-danger disabled:opacity-40"
                    disabled={saving}
                    onClick={() => void onDelete()}
                  >
                    {saving ? "Deleting…" : "Delete this alert"}
                  </button>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground"
                    disabled={saving}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="text-sm text-danger" disabled={saving} onClick={() => setConfirmDelete(true)}>
                Delete this alert
              </button>
            )}
          </Card>
        ) : null}
        {message ? (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function ScopeOption(props: { value: string; label: string; hint: string; checked: boolean; onSelect: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-3">
      <input
        type="radio"
        name="alert-scope"
        value={props.value}
        checked={props.checked}
        onChange={props.onSelect}
        className="mt-1"
      />
      <span>
        <span className="block text-sm font-medium">{props.label}</span>
        <span className="block text-sm text-muted-foreground">{props.hint}</span>
      </span>
    </label>
  );
}
