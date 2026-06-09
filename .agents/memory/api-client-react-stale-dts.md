---
name: Stale composite .d.ts after orval codegen
description: Phantom TS2724 "no exported member" errors in apps that consume @workspace/api-client-react via a TS project reference, even when the source clearly exports the symbol.
---

# Stale composite declarations after codegen

`@workspace/api-client-react` is a `composite: true` TS project that emits
declarations to `dist/`. Consuming apps (e.g. `artifacts/ledger-mobile`) pull it
in through a tsconfig `references` entry, so **tsc typechecks them against the
emitted `dist/*.d.ts`, not the `src/` files** — even though the package's
`exports` map points at `src/index.ts` (which is what Metro/runtime use).

**Symptom:** after running orval codegen (which rewrites `src/generated/api.ts`),
an app fails typecheck with `TS2724: '"@workspace/api-client-react"' has no
exported member named 'useXxx'` plus cascading `TS7006` implicit-any errors on
callbacks that consume the now-`any` query result — while the symbol plainly
exists in source and the app runs fine at runtime.

**Why:** codegen updates `src/` but does not rebuild the committed `dist/`
declarations, so the project reference serves the old type surface.

**Fix:** rebuild the declarations after codegen:
`npx tsc --build lib/api-client-react/tsconfig.json --force`
then re-run the app's typecheck. The `dist/` output is committed, so commit the
refreshed declarations alongside the codegen change.

**How to apply:** any time you regenerate the API client (or see a phantom
"no exported member" from `@workspace/api-client-react`), rebuild its composite
output before trusting tsc.
