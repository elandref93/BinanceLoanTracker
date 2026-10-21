import { ClerkProvider } from "@clerk/react-router";
import type { ReactNode } from "react";

import { ledgerClerkAppearance } from "@/auth/clerkAppearance";

export function ClerkGate(props: { publishableKey: string; children: ReactNode }) {
  if (props.publishableKey.length === 0) {
    return props.children;
  }
  return (
    <ClerkProvider
      publishableKey={props.publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      afterSignOutUrl="/sign-in"
      appearance={ledgerClerkAppearance}
    >
      {props.children}
    </ClerkProvider>
  );
}
