# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **TestFlight builds are manual-only.** The Run button (the "Project" workflow) only starts the dev environment — it does NOT build. To publish a build, run it yourself from the Shell: `pnpm --filter @workspace/ledger-mobile run tf:build` (this is `eas build -p ios --profile production --auto-submit`). Do NOT wire this command into the Run button / "Project" workflow again — doing so makes every project start/wake create and auto-submit a TestFlight build, which silently burns EAS build credits.
- The three dev servers (api-server, ledger-mobile/expo, mockup-sandbox) auto-start on their own as artifact services; the Run button does not need to start them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
