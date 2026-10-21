import { Show, UserButton } from "@clerk/react-router";
import type { ReactNode } from "react";
import { Link } from "react-router";

const primaryButton =
  "rounded-ledger bg-primary px-3 py-2 text-sm font-medium text-primary-foreground";

export function ClerkNav(): ReactNode {
  return (
    <div className="flex items-center gap-2 md:mt-4">
      <Show when="signed-out">
        <Link to="/sign-in" className={primaryButton}>
          Sign in with Apple
        </Link>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
