import { Link } from "react-router";

import { Card, EmptyState, Notice } from "@/ui/primitives";

/** Shown when a portfolio endpoint answers `available: false`. */
export function PortfolioUnavailable(props: { reason?: string; title?: string }) {
  if (props.reason === "no_accounts") {
    return (
      <Card className="mx-auto mt-6 max-w-lg">
        <EmptyState
          icon="wallet"
          title="Connect an exchange to see your net worth"
          body="Add a read-only Binance or Luno key. Keys stay encrypted on the server, never in this browser."
          action={
            <Link to="/onboarding" className="inline-flex min-h-11 items-center rounded-ledger bg-primary px-4 font-medium text-primary-foreground">
              Add an account
            </Link>
          }
        />
      </Card>
    );
  }
  const message =
    props.reason === "encryption_not_configured"
      ? "The server cannot read stored keys because its encryption key is not set."
      : "The first snapshot of your accounts did not complete. Ledger tries again on the next refresh.";
  return (
    <Notice tone="warn" title={props.title ?? "Net worth is not available yet"} className="mt-4">
      {message}
    </Notice>
  );
}
