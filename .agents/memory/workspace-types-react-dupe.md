---
name: Workspace @types/react dupe via cmdk subtree
description: Mixed Expo (older) + non-Expo (newer) deps drag in two @types/react versions; TS errors "two unrelated types with this name". Delete unused consumers first, dedupe only if needed.
---

Symptom: `tsc` errors of the form *"Two different types with this name exist, but they are unrelated"* on JSX elements like `<div ref={…}>` inside shadcn-style components.

**Why:** pnpm's strict isolation means a transitive dep (e.g. `cmdk@1.1.1`) can pull `@types/react@19.2.x` into its own `.pnpm/...` subtree while Expo SDK 54 transitives still pin `@types/react@19.1.x` elsewhere. Both copies coexist in `node_modules/.pnpm`. TS resolves each consumer through its own chain and sees two distinct (structurally identical) declarations of `React.Ref`, etc.

**How to apply:**
1. First check whether the offending consumer file is actually imported. Shadcn boilerplate (`calendar.tsx`, `spinner.tsx`, etc.) is often dead — deleting it removes the type clash without touching the lockfile.
2. Only if the consumer is real, force a single version via root `pnpm.overrides`/`pnpm.peerDependencyRules` and reinstall. `skipLibCheck` won't help — the error is in *user* code.
3. The pnpm-workspace catalog pinning `@types/react` doesn't fix this on its own; pnpm honors transitive subtrees.
