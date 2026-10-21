import { Outlet } from "react-router";

import { LedgerMark } from "@/ui/LedgerMark";

/** Full-screen frame for first-run setup: no tabs, no sidebar. */
export function SetupLayout() {
  return (
    <div className="min-h-dvh px-4 pt-safe pb-safe pl-safe pr-safe sm:px-6">
      <header className="mx-auto flex h-16 max-w-2xl items-center gap-2.5">
        <LedgerMark size={28} />
        <span className="text-heading font-semibold tracking-tight">Ledger</span>
      </header>
      <main id="main" className="mx-auto max-w-2xl pb-10 animate-rise-in">
        <Outlet />
      </main>
    </div>
  );
}
