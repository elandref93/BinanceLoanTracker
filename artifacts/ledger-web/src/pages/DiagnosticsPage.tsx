import { getCredentials, getSettingsSync, useGetLtvSnapshot } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { accountSyncQueryKey, loadAccountSync } from "@/accounts/accountApi";
import { errorStatus } from "@/accounts/accountModel";
import {
  diagnosticsReport,
  DIAGNOSTICS_OMISSION,
  FX_NOT_RETURNED,
  keyHealthRows,
  LAST_ERROR_ABSENT,
  serverRateText,
  timestampLabel,
} from "@/domain/settingsView";
import { useBrowserSession } from "@/session/SessionProvider";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4 text-foreground">{props.children}</div>;
}

async function loadSettingsClock(): Promise<string | null> {
  try {
    const record = await getSettingsSync();
    return timestampLabel(record.updatedAt);
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

export function DiagnosticsPage() {
  const session = useBrowserSession();
  const snapshot = useGetLtvSnapshot();
  const accounts = useQuery({ queryKey: accountSyncQueryKey, queryFn: loadAccountSync });
  const credentials = useQuery({ queryKey: ["credential-meta"], queryFn: () => getCredentials() });
  const settingsClock = useQuery({ queryKey: ["settings-sync-clock"], queryFn: loadSettingsClock });
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const rateText = snapshot.isError
    ? "The snapshot could not be loaded. No exchange rate is shown."
    : snapshot.isSuccess
      ? snapshot.data.available
        ? serverRateText(snapshot.data.snapshot ?? null)
        : FX_NOT_RETURNED
      : "Loading the server rate…";
  const health =
    credentials.isSuccess && accounts.isSuccess
      ? keyHealthRows({ containers: accounts.data, credentials: credentials.data })
      : null;
  const profileCount = accounts.isSuccess ? String(accounts.data.length) : accounts.isError ? "Could not be loaded" : "Loading…";
  const email = session.user?.email ?? "No email on this session";
  const lines = [
    `USD/ZAR: ${rateText}`,
    `Profiles: ${profileCount}`,
    `Settings time: ${settingsClock.data ?? (settingsClock.isError ? "Could not be loaded" : "Not stored")}`,
    `Session email: ${email}`,
    "Session cookie is HttpOnly and is not shown.",
    health ? health.note : credentials.isError ? "Key health could not be loaded." : "Loading key status…",
    ...(health?.rows ?? []).map(
      (row) =>
        `${row.profile} ${row.exchange}: ${row.presence === "present" ? "Present" : "Missing"}. ${row.lastError ?? LAST_ERROR_ABSENT}`,
    ),
  ];
  const report = diagnosticsReport(lines);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(report);
      setCopyNote("Copied the diagnostics text.");
    } catch {
      setCopyNote("Copy is unavailable. The text below is the diagnostics report.");
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Status for this session. {DIAGNOSTICS_OMISSION} Dates and times are Africa/Johannesburg.
      </p>
      <div className="mt-4 space-y-3">
        <Card>
          <h2 className="text-sm font-medium">Server rate</h2>
          <p className="mt-2 text-sm">{rateText}</p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium">Report</h2>
          <pre className="mt-3 overflow-x-auto text-sm whitespace-pre-wrap">{report}</pre>
          <button type="button" className="mt-3 rounded-ledger border border-border px-4 py-2 text-sm" onClick={() => void onCopy()}>
            Copy report
          </button>
          {copyNote ? <p className="mt-2 text-sm text-muted-foreground">{copyNote}</p> : null}
        </Card>
      </div>
    </section>
  );
}
