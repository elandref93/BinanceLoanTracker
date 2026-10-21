import { HandleSSOCallback, useAuth, useSignIn } from "@clerk/react-router";
import { useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import { clerkSignInStatusMessage } from "@/session/browserSession";
import { useBrowserSession } from "@/session/SessionProvider";
import { FullScreenMessage } from "@/ui/FullScreenMessage";
import { Icon } from "@/ui/Icon";
import { LedgerMark } from "@/ui/LedgerMark";

export function SignInPage(props: { clerkEnabled: boolean }) {
  if (!props.clerkEnabled) {
    return (
      <SignInFrame>
        <p role="alert" className="mt-8 text-caption text-muted-foreground">
          Sign-in is not configured on this server. No session was created.
        </p>
      </SignInFrame>
    );
  }
  return <ClerkSignInPage />;
}

function SignInFrame(props: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 pt-safe pb-safe">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center text-center animate-rise-in">
        <LedgerMark size={72} />
        <h1 className="mt-6 text-[32px] font-semibold leading-tight tracking-tight">Ledger</h1>
        <p className="mt-2 text-body text-muted-foreground">Your portfolio, loans and collateral in one calm place.</p>
        {props.children}
      </div>
      <p className="absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5 text-micro text-subtle">
        <Icon name="shield" size={14} />
        Private. Invited Apple IDs only.
      </p>
    </main>
  );
}

function ClerkSignInPage() {
  const session = useBrowserSession();
  const { isLoaded, isSignedIn } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const message = clerkSignInStatusMessage(params.get("error"));

  if (pathname.startsWith("/sign-in/sso-callback")) {
    return <AppleSsoCallback />;
  }
  if (!isLoaded || session.isPending || (isSignedIn && !session.user)) {
    return <FullScreenMessage tone="loading" title="Signing you in" />;
  }
  if (session.user) {
    return <Navigate to="/" replace />;
  }

  return (
    <SignInFrame>
      {message ? (
        <p role="alert" className="mt-6 w-full rounded-ledger border border-danger/40 bg-danger/10 px-4 py-3 text-caption text-danger">
          {message}
        </p>
      ) : null}
      <AppleSignInButton />
    </SignInFrame>
  );
}

function AppleSsoCallback() {
  const navigate = useNavigate();
  return (
    <>
      <FullScreenMessage tone="loading" title="Signing you in" />
      <HandleSSOCallback
        navigateToApp={() => {
          navigate("/", { replace: true });
        }}
        navigateToSignIn={() => {
          navigate("/sign-in?error=not_allowed", { replace: true });
        }}
        navigateToSignUp={() => {
          navigate("/sign-in", { replace: true });
        }}
      />
    </>
  );
}

function AppleSignInButton() {
  const { signIn, fetchStatus } = useSignIn();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startAppleSignIn(): Promise<void> {
    setError(null);
    setPending(true);
    const result = await signIn.sso({
      strategy: "oauth_apple",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    });
    if (result.error) {
      setPending(false);
      setError("Sign in with Apple did not start. No session was created.");
    }
  }

  const busy = fetchStatus === "fetching" || pending;
  return (
    <div className="mt-10 w-full">
      <button
        type="button"
        className="flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-white text-[17px] font-semibold text-black shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60"
        disabled={busy}
        onClick={() => {
          void startAppleSignIn();
        }}
      >
        <svg width="18" height="22" viewBox="0 0 17 21" aria-hidden="true" fill="currentColor">
          <path d="M14.2 11.2c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.6-4.2ZM11.8 3.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z" />
        </svg>
        {busy ? "Opening Apple…" : "Sign in with Apple"}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
