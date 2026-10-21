import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import { fmtAge } from "@/domain/format";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4">{props.children}</div>;
}

function exchangeName(exchange: "binance" | "luno"): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

export function AccountsPage() {
  const accounts = useQuery({
    queryKey: accountSyncQueryKey,
    queryFn: loadAccountSync,
  });

  return (
    <section className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <Link className="rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" to="/onboarding">
          Add account
        </Link>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Personal and Trust profiles from the synced account list. API keys are not in this list.
      </p>
      <div className="mt-4 space-y-3">
        {accounts.isPending ? <p role="status">Loading accounts…</p> : null}
        {accounts.isError ? (
          <p role="alert" className="text-danger">
            Accounts could not be loaded.{" "}
            <button type="button" className="text-primary" onClick={() => void accounts.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {accounts.data && accounts.data.length === 0 ? (
          <Card>
            <p>No accounts connected.</p>
            <p className="mt-2 text-sm text-muted-foreground">Add a Binance or Luno key to start a profile.</p>
          </Card>
        ) : null}
        {accounts.data?.map((container) => (
          <Card key={container.id}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-medium">{container.name}</h2>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">{container.type}</span>
            </div>
            {container.links.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No exchanges linked yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {container.links.map((link) => (
                  <li key={link.id} className="flex justify-between gap-3">
                    <span>
                      {exchangeName(link.exchange)}
                      {link.label ? ` · ${link.label}` : ""}
                    </span>
                    <span className="text-muted-foreground">{fmtAge(link.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3">
              <Link className="text-sm text-primary" to={`/settings/accounts/${encodeURIComponent(container.id)}`}>
                Account settings
              </Link>
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
