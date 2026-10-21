import { getScenarioSync, putScenarioSync, type OpaqueObject } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorStatus } from "@/accounts/accountModel";
import {
  DRAFT_NOT_SAVED,
  deleteScenarioFromList,
  formInputsFromStored,
  namedScenarios,
  saveScenarioInList,
} from "@/domain/leverageScenarios";
import type { LeverageInputs } from "@/domain/leverageSim";

export const scenarioSyncQueryKey = ["scenario-sync"] as const;

type SaveResult =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; message: string };

async function loadScenarioPayload(): Promise<unknown[]> {
  try {
    const record = await getScenarioSync();
    return Array.isArray(record.scenarios) ? record.scenarios : [];
  } catch (error) {
    if (errorStatus(error) === 404) return [];
    throw error;
  }
}

async function writeScenarios(scenarios: unknown[]): Promise<SaveResult> {
  try {
    await putScenarioSync({ scenarios: scenarios as OpaqueObject[] });
    return { ok: true };
  } catch (error) {
    if (errorStatus(error) === 409) return { ok: false, conflict: true };
    return { ok: false, conflict: false, message: "Could not save scenarios." };
  }
}

export function SavedScenarios(props: {
  inputs: LeverageInputs;
  onApply: (inputs: LeverageInputs) => void;
  onReset: () => void;
  onActiveName: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scenarioSyncQueryKey, queryFn: loadScenarioPayload });
  const [name, setName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = query.isSuccess ? namedScenarios(query.data) : [];

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: scenarioSyncQueryKey });
  }

  async function onSave(): Promise<void> {
    if (!query.isSuccess || busy) return;
    setBusy(true);
    const trimmed = name.trim() || `Scenario ${saved.length + 1}`;
    const next = saveScenarioInList(query.data, {
      id: activeId ?? undefined,
      name: trimmed,
      inputs: props.inputs,
      now: new Date().toISOString(),
    });
    const result = await writeScenarios(next.scenarios);
    if (result.ok) {
      setActiveId(next.saved.id);
      setName(trimmed);
      props.onActiveName(trimmed);
      setStatus("Saved.");
      await refresh();
    } else if (result.conflict) {
      setActiveId(null);
      props.onActiveName("Unsaved scenario");
      setStatus("Saved scenarios changed on another device. The list was reloaded.");
      await refresh();
    } else {
      setStatus(result.message);
    }
    setBusy(false);
  }

  async function onDelete(id: string, label: string): Promise<void> {
    if (!query.isSuccess || busy) return;
    setBusy(true);
    const result = await writeScenarios(deleteScenarioFromList(query.data, id));
    if (result.ok) {
      if (activeId === id) {
        setActiveId(null);
        setName("");
        props.onActiveName("Unsaved scenario");
      }
      setStatus(`Removed ${label}.`);
      await refresh();
    } else if (result.conflict) {
      setStatus("Saved scenarios changed on another device. The list was reloaded.");
      await refresh();
    } else {
      setStatus(result.message);
    }
    setBusy(false);
  }

  function onNew(): void {
    setActiveId(null);
    setName("");
    setStatus(null);
    props.onActiveName("Unsaved scenario");
    props.onReset();
  }

  function onLoad(id: string): void {
    const match = saved.find((item) => item.id === id);
    if (!match) return;
    props.onApply(formInputsFromStored(match.inputs));
    setActiveId(match.id);
    setName(match.name);
    props.onActiveName(match.name);
    setStatus(null);
  }

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground">Saved scenarios</h2>
      {query.isPending ? <p role="status">Loading saved scenarios…</p> : null}
      {query.isError ? (
        <p role="alert">Saved scenarios could not be loaded. Nothing was written over the server list.</p>
      ) : null}
      {query.isSuccess && saved.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved scenarios yet.</p>
      ) : null}
      {activeId == null ? <p className="mt-2 text-sm text-muted-foreground">{DRAFT_NOT_SAVED}</p> : null}
      {status ? (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      ) : null}
      <label className="mt-3 block text-xs font-semibold tracking-wide text-muted-foreground" htmlFor="scenario-name">
        Scenario name
      </label>
      <input
        id="scenario-name"
        value={name}
        className="mt-1 w-full rounded-ledger border border-border bg-background px-3 py-2 text-sm"
        onChange={(event) => setName(event.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-ledger border border-border px-3 py-1.5 text-sm" onClick={onNew}>
          New
        </button>
        <button
          type="button"
          className="rounded-ledger bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          disabled={!query.isSuccess || busy}
          onClick={() => {
            void onSave();
          }}
        >
          {busy ? "Saving…" : activeId ? "Save" : "Save as"}
        </button>
      </div>
      {saved.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {saved.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-ledger border border-border px-3 py-1.5 text-sm"
                aria-pressed={activeId === item.id}
                onClick={() => onLoad(item.id)}
              >
                {item.name}
              </button>
              <button
                type="button"
                className="rounded-ledger border border-border px-3 py-1.5 text-sm text-muted-foreground"
                disabled={busy}
                aria-label={`Delete ${item.name}`}
                onClick={() => {
                  void onDelete(item.id, item.name);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
