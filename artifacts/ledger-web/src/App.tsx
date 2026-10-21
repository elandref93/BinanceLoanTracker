import { setBaseUrl, setExtraHeadersGetter, setFetchCredentials } from "@workspace/api-client-react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router";

import { ApiConfigProvider } from "@/apiConfig";
import { ClerkGate } from "@/auth/ClerkGate";
import { ClerkSessionBridge } from "@/auth/ClerkSessionBridge";
import { ClerkSignOutRegistrar } from "@/auth/signOut";
import { readWebEnv, type WebEnv } from "@/env";
import {
  AccountDetailPage,
  AccountsPage,
  AlertRuleEditorPage,
  DiagnosticsPage,
  HistoryPage,
  HomePage,
  InsightsPage,
  LoansPage,
  OnboardingPage,
  PortfolioPage,
  SettingsPage,
  SignInPage,
  StrategyPage,
} from "@/pages/screens";
import { PreferencesProvider } from "@/prefs/PreferencesProvider";
import { createAppQueryClient } from "@/queryClient";
import { csrfHeaders } from "@/session/browserSession";
import { BrowserSessionProvider, RequireSession } from "@/session/SessionProvider";
import { AppShell } from "@/shell/AppShell";
import { SetupLayout } from "@/shell/AuthLayout";
import { RefreshProvider } from "@/shell/RefreshProvider";

const queryClient = createAppQueryClient();

function RedirectWithParam(props: { to: (param: string) => string; param: string }) {
  const params = useParams();
  const value = params[props.param];
  return <Navigate to={value ? props.to(encodeURIComponent(value)) : "/"} replace />;
}

export function App({ env, clerkPublishableKey }: { env: WebEnv; clerkPublishableKey: string }) {
  setBaseUrl(env.apiBaseUrl || null);
  setFetchCredentials("include");
  setExtraHeadersGetter(() => {
    if (typeof document === "undefined") return null;
    return csrfHeaders("POST", document.cookie);
  });
  const clerkEnabled = clerkPublishableKey.length > 0;
  return (
    <ApiConfigProvider value={env}>
      <QueryClientProvider client={queryClient}>
        <BrowserSessionProvider apiBaseUrl={env.apiBaseUrl}>
          <PreferencesProvider>
            <RefreshProvider>
              <BrowserRouter>
                <ClerkGate publishableKey={clerkPublishableKey}>
                  {clerkEnabled ? (
                    <>
                      <ClerkSessionBridge apiBaseUrl={env.apiBaseUrl} />
                      <ClerkSignOutRegistrar />
                    </>
                  ) : null}
                  <Routes>
                    <Route path="/sign-in/*" element={<SignInPage clerkEnabled={clerkEnabled} />} />
                    <Route path="/sign-up/*" element={<Navigate to="/sign-in" replace />} />
                    <Route element={<RequireSession />}>
                      <Route element={<SetupLayout />}>
                        <Route path="/onboarding" element={<OnboardingPage />} />
                      </Route>
                      <Route element={<AppShell />}>
                        <Route index element={<HomePage />} />
                        <Route path="portfolio/:asset?" element={<PortfolioPage />} />
                        <Route path="loans/history" element={<HistoryPage />} />
                        <Route path="loans/:loanId?" element={<LoansPage />} />
                        <Route path="insights" element={<InsightsPage />} />
                        <Route path="strategy" element={<StrategyPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="settings/accounts" element={<AccountsPage />} />
                        <Route path="settings/accounts/:accountId" element={<AccountDetailPage />} />
                        <Route path="settings/alerts/new" element={<AlertRuleEditorPage />} />
                        <Route path="settings/alerts/:ruleId" element={<AlertRuleEditorPage />} />
                        <Route path="settings/diagnostics" element={<DiagnosticsPage />} />
                        <Route path="history" element={<Navigate to="/loans/history" replace />} />
                        <Route path="accounts" element={<Navigate to="/settings/accounts" replace />} />
                        <Route
                          path="accounts/:accountId"
                          element={<RedirectWithParam param="accountId" to={(id) => `/settings/accounts/${id}`} />}
                        />
                        <Route path="alerts/new" element={<Navigate to="/settings/alerts/new" replace />} />
                        <Route
                          path="alerts/:ruleId"
                          element={<RedirectWithParam param="ruleId" to={(id) => `/settings/alerts/${id}`} />}
                        />
                        <Route path="diagnostics" element={<Navigate to="/settings/diagnostics" replace />} />
                      </Route>
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </ClerkGate>
              </BrowserRouter>
            </RefreshProvider>
          </PreferencesProvider>
        </BrowserSessionProvider>
      </QueryClientProvider>
    </ApiConfigProvider>
  );
}

export function AppRoot(): ReactNode {
  let env: WebEnv;
  try {
    env = readWebEnv(import.meta.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid environment";
    return (
      <p role="alert" className="m-6 text-danger">
        {message}
      </p>
    );
  }
  const rawClerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const clerkPublishableKey = typeof rawClerkKey === "string" ? rawClerkKey.trim() : "";
  return <App env={env} clerkPublishableKey={clerkPublishableKey} />;
}
