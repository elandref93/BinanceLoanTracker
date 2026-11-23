/** The single address that may complete Sign in with Apple or Microsoft. */
export function allowedSignInEmail(env: NodeJS.ProcessEnv = process.env): string {
  return (env.LEDGER_SIGN_IN_EMAIL ?? "").trim().toLowerCase();
}
