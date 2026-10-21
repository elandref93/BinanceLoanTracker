import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { accountSyncQueryKey, accountWriteApi, loadAccountSync } from "@/accounts/accountApi";
import {
  commitRemove,
  commitRename,
  planRemoveContainer,
  planRemoveLink,
  planRename,
  safeClientMessage,
} from "@/accounts/accountModel";
import { fmtDate } from "@/domain/format";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4">{props.children}</div>;
}

function exchangeName(exchange: "binance" | "luno"): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

export function AccountDetailPage() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: accountSyncQueryKey,
    queryFn: loadAccountSync,
  });
  const container = accounts.data?.find((item) => item.id === accountId) ?? null;
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<
    null | { kind: "account" } | { kind: "link"; id: string; label: string }
  >(null);

  useEffect(() => {
    setLabel(container?.label ?? "");
  }, [container?.id, container?.label]);

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: accountSyncQueryKey });
  }

  async function onRename(): Promise<void> {
    if (!accounts.data || !container) return;
    setBusy(true);
    setError(null);
    try {
      await commitRename(accountWriteApi, planRename(accounts.data, container.id, label.trim() || null));
      await refresh();
    } catch (caught) {
      setError(safeClientMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRemove(): Promise<void> {
    if (!accounts.data || !container || !pending) return;
    setBusy(true);
    setError(null);
    try {
      const plan =
        pending.kind === "account"
          ? planRemoveContainer(accounts.data, container.id)
          : planRemoveLink(accounts.data, container.id, pending.id);
      await commitRemove(accountWriteApi, plan);
      await refresh();
      setPending(null);
      if (pending.kind === "account") navigate("/settings/accounts", { replace: true });
    } catch (caught) {
      setError(safeClientMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-sm">
        <Link className="text-primary" to="/settings/accounts">
          Accounts
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{container?.name ?? "Account"}</h1>
      <div className="mt-4 space-y-3">
        {accounts.isPending ? <p role="status">Loading account…</p> : null}
        {accounts.isError ? (
          <p role="alert" className="text-danger">
            This account could not be loaded.
          </p>
        ) : null}
        {accounts.isSuccess && !container ? (
          <Card>
            <p>This account is not in the synced list.</p>
          </Card>
        ) : null}
        {container ? (
          <>
            <Card>
              <label className="block text-sm text-muted-foreground" htmlFor="account-label">
                Label
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                Optional. Leave blank to use the {container.type} name only.
              </p>
              <input
                id="account-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="mt-3 w-full rounded-ledger border border-border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                className="mt-3 rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                disabled={busy}
                onClick={() => void onRename()}
              >
                Save name
              </button>
            </Card>
            <Card>
              <h2 className="text-sm font-medium">Exchange links</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The API key for each link is stored only on the server.
              </p>
              {container.links.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No exchanges linked yet.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {container.links.map((link) => (
                    <li key={link.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        {exchangeName(link.exchange)}
                        {link.label ? ` · ${link.label}` : ""}
                        <span className="block text-muted-foreground">Added {fmtDate(link.createdAt)}</span>
                      </span>
                      <button
                        type="button"
                        className="text-danger"
                        disabled={busy}
                        onClick={() =>
                          setPending({
                            kind: "link",
                            id: link.id,
                            label: link.label ? `${exchangeName(link.exchange)} · ${link.label}` : exchangeName(link.exchange),
                          })
                        }
                      >
                        Remove link
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4">
                <Link className="text-sm text-primary" to="/onboarding">
                  Add another exchange
                </Link>
              </p>
            </Card>
            <Card>
              {pending ? (
                <div>
                  <p>
                    {pending.kind === "account"
                      ? `Remove ${container.name}? This deletes the server credential for every link on this account.`
                      : `Remove ${pending.label}? This deletes that link's server credential.`}
                  </p>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      className="rounded-ledger border border-danger px-4 py-2 text-sm text-danger disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void onConfirmRemove()}
                    >
                      {busy ? "Removing…" : "Delete server credential"}
                    </button>
                    <button type="button" className="text-sm text-muted-foreground" disabled={busy} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-sm text-danger" disabled={busy} onClick={() => setPending({ kind: "account" })}>
                  Remove account
                </button>
              )}
            </Card>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
