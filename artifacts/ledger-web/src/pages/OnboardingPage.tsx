import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { accountSyncQueryKey, accountWriteApi, loadAccountSync } from "@/accounts/accountApi";
import {
  commitAddLink,
  createContainerId,
  createLinkId,
  planAddLink,
  ProfileAlreadyHasLinkError,
  safeClientMessage,
  soleOpenProfile,
  type ContainerChoice,
  type ExchangeKind,
  type ProfileType,
  type SyncContainer,
} from "@/accounts/accountModel";
import { validateExchangeCredentials } from "@/accounts/credentialValidation";
import { parseBinanceQR } from "@/accounts/parseBinanceQR";

const inputClass =
  "w-full rounded-ledger border border-border bg-background px-3 py-2 text-sm text-foreground";

function Card(props: { children: ReactNode }) {
  return <div className="rounded-ledger border border-border bg-card p-4">{props.children}</div>;
}

function exchangeTitle(exchange: ExchangeKind): string {
  return exchange === "binance" ? "Binance" : "Luno";
}

function profileName(choice: ContainerChoice, containers: SyncContainer[]): string {
  if (choice.kind === "existing") {
    return containers.find((container) => container.id === choice.id)?.name ?? "profile";
  }
  const type = choice.type === "trust" ? "Trust" : "Personal";
  return choice.label ? `${type} · ${choice.label}` : type;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: accountSyncQueryKey,
    queryFn: loadAccountSync,
  });
  const containers = accounts.data ?? [];
  const [exchange, setExchange] = useState<ExchangeKind | null>(null);
  const [draft, setDraft] = useState<ContainerChoice | null>(null);
  const [choice, setChoice] = useState<ContainerChoice | null>(null);
  const [autoDone, setAutoDone] = useState(false);
  const [profileType, setProfileType] = useState<ProfileType>("personal");
  const [profileLabel, setProfileLabel] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [revealSecret, setRevealSecret] = useState(false);
  const [qrText, setQrText] = useState("");
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step = exchange == null ? "exchange" : choice == null ? "profile" : "credentials";

  useEffect(() => {
    if (autoDone || !exchange || choice || !accounts.data) return;
    const id = soleOpenProfile(accounts.data, exchange);
    setAutoDone(true);
    if (id) setChoice({ kind: "existing", id });
  }, [autoDone, exchange, choice, accounts.data]);

  function clearSecrets(): void {
    setApiKey("");
    setApiSecret("");
    setQrText("");
    setRevealSecret(false);
    setScanInfo(null);
  }

  function pickExchange(next: ExchangeKind): void {
    setExchange(next);
    setChoice(null);
    setDraft(null);
    setAutoDone(false);
    setError(null);
    clearSecrets();
  }

  function applyQr(): void {
    const parsed = parseBinanceQR(qrText);
    setQrText("");
    if (!parsed.apiKey && !parsed.apiSecret) {
      setScanInfo(null);
      setError("That QR code didn't contain a Binance API key. Enter it manually below.");
      return;
    }
    setError(null);
    if (parsed.apiKey) setApiKey(parsed.apiKey);
    if (parsed.apiSecret) setApiSecret(parsed.apiSecret);
    if (parsed.apiKey && parsed.apiSecret) setScanInfo("Read the API key and secret from the pasted text. Review, then Save.");
    else if (parsed.apiKey) setScanInfo("Read the API key. Enter the secret to continue.");
    else setScanInfo("Read the secret. Enter the API key to continue.");
  }

  async function onSave(): Promise<void> {
    if (!exchange || !choice || !accounts.data) return;
    const validation = validateExchangeCredentials(exchange, apiKey, apiSecret);
    if (validation) {
      setError(validation);
      return;
    }
    const confirmed: ContainerChoice =
      choice.kind === "new"
        ? { kind: "new", type: profileType, label: profileLabel.trim() || undefined }
        : choice;
    setBusy(true);
    setError(null);
    try {
      const plan = planAddLink(
        accounts.data,
        confirmed,
        { exchange, label: linkLabel, apiKey, apiSecret },
        {
          nowIso: new Date().toISOString(),
          linkId: createLinkId(),
          containerId: confirmed.kind === "new" ? createContainerId() : undefined,
        },
      );
      await commitAddLink(accountWriteApi, plan);
      clearSecrets();
      await queryClient.invalidateQueries({ queryKey: accountSyncQueryKey });
      navigate("/settings/accounts", { replace: true });
    } catch (caught) {
      if (caught instanceof ProfileAlreadyHasLinkError) setError(caught.message);
      else setError(safeClientMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col px-6 py-10">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {step === "exchange" ? "Step 1 of 3 · Exchange" : step === "profile" ? "Step 2 of 3 · Profile" : "Step 3 of 3 · Credentials"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold">
        {exchange ? `Add ${exchangeTitle(exchange)}` : "Add an exchange"}
      </h1>
      <div className="mt-6 space-y-4">
        {accounts.isPending ? <p role="status">Loading accounts…</p> : null}
        {accounts.isError ? (
          <p role="alert" className="text-sm text-danger">
            Accounts could not be loaded, so a new profile cannot be saved yet.{" "}
            <button type="button" className="text-primary" onClick={() => void accounts.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-ledger border border-danger px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {step === "exchange" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Which exchange do you want to link?</p>
            <button type="button" className="block w-full rounded-ledger border border-border bg-card p-4 text-left" onClick={() => pickExchange("binance")}>
              <span className="block font-medium">Binance</span>
              <span className="mt-1 block text-sm text-muted-foreground">Loans, margin, collateral, interest history.</span>
            </button>
            <button type="button" className="block w-full rounded-ledger border border-border bg-card p-4 text-left" onClick={() => pickExchange("luno")}>
              <span className="block font-medium">Luno</span>
              <span className="mt-1 block text-sm text-muted-foreground">ZAR balance, BTC wallets, transactions, pending sends.</span>
            </button>
            <p className="text-sm text-muted-foreground">
              Use a read-only key. It is sent once to the server and is not stored in this browser.
            </p>
          </div>
        ) : null}

        {step === "profile" && exchange ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Link this {exchangeTitle(exchange)} key to a profile, or create one. Each profile can hold one Binance link and one Luno link.
            </p>
            {containers.map((container) => {
              const blocked = container.links.some((link) => link.exchange === exchange);
              const selected = draft?.kind === "existing" && draft.id === container.id;
              return (
                <button
                  key={container.id}
                  type="button"
                  disabled={blocked}
                  aria-pressed={selected}
                  className={`block w-full rounded-ledger border p-4 text-left disabled:opacity-40 ${selected ? "border-primary" : "border-border"} bg-card`}
                  onClick={() => setDraft({ kind: "existing", id: container.id })}
                >
                  <span className="block font-medium">{container.name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {blocked
                      ? `Already has a ${exchangeTitle(exchange)} link`
                      : container.links.length === 0
                        ? "No exchanges linked yet"
                        : container.links.map((link) => exchangeTitle(link.exchange)).join(" · ")}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={draft?.kind === "new"}
              className={`block w-full rounded-ledger border p-4 text-left ${draft?.kind === "new" ? "border-primary" : "border-border"} bg-card`}
              onClick={() =>
                setDraft({ kind: "new", type: profileType, label: profileLabel.trim() || undefined })
              }
            >
              <span className="block font-medium">New profile</span>
              <span className="mt-1 block text-sm text-muted-foreground">Personal or Trust.</span>
            </button>
            {draft?.kind === "new" ? (
              <Card>
                <div className="flex gap-2">
                  {(["personal", "trust"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={profileType === type}
                      className={
                        profileType === type
                          ? "rounded-ledger bg-primary px-3 py-2 text-sm text-primary-foreground"
                          : "rounded-ledger border border-border px-3 py-2 text-sm"
                      }
                      onClick={() => {
                        setProfileType(type);
                        setDraft({ kind: "new", type, label: profileLabel.trim() || undefined });
                      }}
                    >
                      {type === "personal" ? "Personal" : "Trust"}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block text-sm text-muted-foreground" htmlFor="profile-label">
                  Label (optional)
                </label>
                <input
                  id="profile-label"
                  value={profileLabel}
                  onChange={(event) => {
                    setProfileLabel(event.target.value);
                    setDraft({
                      kind: "new",
                      type: profileType,
                      label: event.target.value.trim() || undefined,
                    });
                  }}
                  placeholder={profileType === "trust" ? "Family Trust" : "Your name"}
                  className={`mt-2 ${inputClass}`}
                  autoComplete="off"
                />
              </Card>
            ) : null}
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                disabled={!draft}
                onClick={() => {
                  if (!draft) return;
                  setChoice(
                    draft.kind === "new"
                      ? { kind: "new", type: profileType, label: profileLabel.trim() || undefined }
                      : draft,
                  );
                  setError(null);
                }}
              >
                Continue
              </button>
              <button type="button" className="text-sm text-muted-foreground" onClick={() => setExchange(null)}>
                Back
              </button>
            </div>
          </div>
        ) : null}

        {step === "credentials" && exchange && choice ? (
          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <Card>
              <p className="text-sm text-muted-foreground">
                {exchange === "binance"
                  ? "On Binance enable only “Read Info”."
                  : "On Luno enable only Perm_R_Balance, Perm_R_Transactions, and Perm_R_Orders."}{" "}
                The key is sent once to the server and is not stored in this browser.
              </p>
            </Card>
            <p className="text-sm text-muted-foreground">
              Linking to <span className="text-foreground">{profileName(choice, containers)}</span>
            </p>
            {exchange === "binance" ? (
              <div>
                <label className="text-sm text-muted-foreground" htmlFor="qr-text">
                  Paste Binance QR text
                </label>
                <textarea
                  id="qr-text"
                  value={qrText}
                  onChange={(event) => setQrText(event.target.value)}
                  className={`mt-2 min-h-20 ${inputClass}`}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="mt-2 text-sm text-primary" onClick={applyQr}>
                  Use pasted text
                </button>
                {scanInfo ? <p className="mt-2 text-sm text-primary">{scanInfo}</p> : null}
              </div>
            ) : null}
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="link-label">
                Link label (optional)
              </label>
              <input
                id="link-label"
                value={linkLabel}
                onChange={(event) => setLinkLabel(event.target.value)}
                className={`mt-2 ${inputClass}`}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="api-key">
                {exchange === "binance" ? "API key" : "Key ID"}
              </label>
              <textarea
                id="api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className={`mt-2 min-h-16 font-mono ${inputClass}`}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="api-secret">
                {exchange === "binance" ? "API secret" : "Key secret"}
              </label>
              <input
                id="api-secret"
                type={revealSecret ? "text" : "password"}
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                className={`mt-2 font-mono ${inputClass}`}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="mt-2 text-sm text-muted-foreground" onClick={() => setRevealSecret((value) => !value)}>
                {revealSecret ? "Hide secret" : "Show secret"}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-ledger bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                disabled={busy || accounts.isError || accounts.isPending}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="text-sm text-muted-foreground"
                onClick={() => {
                  setChoice(null);
                  setAutoDone(true);
                  clearSecrets();
                  setError(null);
                }}
              >
                Back
              </button>
            </div>
          </form>
        ) : null}

        <p>
          <Link className="text-sm text-primary" to="/settings/accounts">
            Cancel
          </Link>
        </p>
      </div>
    </main>
  );
}
