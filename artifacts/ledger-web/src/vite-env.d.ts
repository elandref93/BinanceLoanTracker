/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface LedgerRuntimePublicConfig {
  apiBaseUrl?: string;
  clerkPublishableKey?: string;
}

interface Window {
  __LEDGER_PUBLIC__?: LedgerRuntimePublicConfig;
}
