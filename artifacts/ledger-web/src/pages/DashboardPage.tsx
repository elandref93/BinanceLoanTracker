import { useGetLtvSnapshot, useHealthCheck } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import type { Status } from "@/domain/risk";
import { healthStatusLabel, dashboardPaint } from "@/pages/dashboardState";
import { useBrowserSession } from "@/session/SessionProvider";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

function toneClass(status: Status): string {
  if (status === "ok") return "text-ok";
  if (status === "warn") return "text-warn";
  return "text-danger";
}

export function DashboardPage() {
  const session = useBrowserSession();
  const health = useHealthCheck();
  const snapshot = useGetLtvSnapshot();
  const accounts = useQuery({
    queryKey: accountSyncQueryKey,
    queryFn: loadAccountSync,
    enabled: session.user != null,
  });
  const [currency, setCurrency] = useState<"USD" | "ZAR">("USD");
  const accountLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const container of accounts.data ?? []) {
      for (const link of container.links) {
        labels.set(link.id, link.label ? `${container.name} · ${link.label}` : container.name);
      }
    }
    return labels;
  }, [accounts.data]);
  const liveness = healthStatusLabel({
    pending: health.isPending,
    failed: health.isError,
    status: health.data?.status,
  });
  const paint = dashboardPaint({
    signedIn: session.user != null,
    pending: snapshot.isPending,
    failed: snapshot.isError,
    envelope: snapshot.data,
    currency,
    accountLabels,
  });

  return (
    <section className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex rounded-ledger border border-border p-1 text-sm">
          {(["USD", "ZAR"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={currency === option}
              className={
                currency === option
                  ? "rounded-ledger bg-primary px-3 py-1 text-primary-foreground"
                  : "rounded-ledger px-3 py-1 text-muted-foreground"
              }
              onClick={() => setCurrency(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">API liveness: {liveness}</p>
      <div className="mt-4 space-y-3">
        {paint.kind !== "snapshot" ? (
          <Card>
            <p role="status">{paint.message}</p>
            {paint.kind === "missing" || paint.kind === "signed-out" ? (
              <p className="mt-3">
                <Link className="text-primary" to="/onboarding">
                  Add an exchange account
                </Link>
              </p>
            ) : null}
          </Card>
        ) : (
          <>
            <Card>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Aggregate LTV</p>
              <p className="mt-1 text-3xl font-semibold">{paint.view.aggregateLtv}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Debt {paint.view.debt}
                <span className="px-2">·</span>
                Collateral {paint.view.collateral}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">As of {paint.view.asOfLabel}, Africa/Johannesburg.</p>
              {paint.view.fxLabel ? (
                <p className="mt-1 text-sm text-muted-foreground">Snapshot rate {paint.view.fxLabel}.</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">This snapshot has no USD to ZAR rate.</p>
              )}
            </Card>
            {paint.view.holdings || paint.view.interestLifetime || paint.view.interestProjected30d ? (
              <Card>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  {paint.view.holdings ? (
                    <div>
                      <dt className="text-muted-foreground">Holdings</dt>
                      <dd>{paint.view.holdings}</dd>
                    </div>
                  ) : null}
                  {paint.view.interestLifetime ? (
                    <div>
                      <dt className="text-muted-foreground">Lifetime interest</dt>
                      <dd>{paint.view.interestLifetime}</dd>
                    </div>
                  ) : null}
                  {paint.view.interestProjected30d ? (
                    <div>
                      <dt className="text-muted-foreground">30-day interest</dt>
                      <dd>{paint.view.interestProjected30d}</dd>
                    </div>
                  ) : null}
                </dl>
              </Card>
            ) : null}
            <Card>
              <h2 className="text-sm font-medium">Profiles</h2>
              {paint.view.containersNote ? (
                <p className="mt-2 text-sm text-muted-foreground">{paint.view.containersNote}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {paint.view.containers.map((container) => (
                    <li key={container.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {container.name}
                        <span className="text-muted-foreground"> · {container.loanCount} loans</span>
                      </span>
                      <span>LTV {container.ltv}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 className="text-sm font-medium">Loans</h2>
              {paint.view.loansNote ? <p className="mt-2 text-sm text-muted-foreground">{paint.view.loansNote}</p> : null}
              {paint.view.closest ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Highest LTV: {paint.view.closest.title} at {paint.view.closest.ltv}. {paint.view.closest.accountLabel}.
                </p>
              ) : null}
              {paint.view.priceNote ? <p className="mt-2 text-sm text-muted-foreground">{paint.view.priceNote}</p> : null}
              <ul className="mt-3 space-y-3">
                {paint.view.loans.map((loan) => (
                  <li key={loan.id} className="rounded-ledger border border-border p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link className="font-medium text-primary" to={`/loans/${encodeURIComponent(loan.id)}`}>
                        {loan.title}
                      </Link>
                      <span className={toneClass(loan.status)}>
                        {loan.ltv} · {loan.statusText}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{loan.accountLabel}</p>
                    <p className="mt-2 text-sm">
                      Debt {loan.debt} · Collateral {loan.collateral} · APR {loan.apr}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{loan.headroom}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
        {accounts.isError ? (
          <p role="alert" className="text-sm text-danger">
            Linked accounts could not be loaded. Loan names stay blank rather than using a guessed profile.
          </p>
        ) : null}
      </div>
    </section>
  );
}
