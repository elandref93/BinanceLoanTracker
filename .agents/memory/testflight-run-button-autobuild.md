---
name: TestFlight builds firing "by themselves"
description: Why EAS/TestFlight builds auto-trigger without a git push, and how the Replit run button must be configured to avoid it.
---

# Auto-triggered TestFlight builds

**Symptom:** TestFlight builds appear on their own (build number keeps incrementing) with no git push, silently consuming EAS build credits.

**Root cause:** The Replit run button is the `"Project"` workflow (`.replit` → `[workflows] runButton = "Project"`). `"Project"` is a `mode = "parallel"` meta-workflow whose tasks are `task = "workflow.run"` references to child workflows. When the project starts/wakes/Run is pressed, `"Project"` runs **every** child. A previous setup had `eas build -p ios --profile production --auto-submit` as a child workflow, so every project start created + auto-submitted a build.

**Rule:** Build/deploy/publish commands must NEVER be a child of the `"Project"` run button. Keep the run button to dev-only tasks.

**How to apply (tooling quirks — important):**
- `.replit` cannot be edited directly (blocked); workflow changes go through the `configureWorkflow` / `removeWorkflow` callbacks (workflows skill).
- `configureWorkflow({name})` is prohibited from using the name `"Project"`, and it **always adds** the configured workflow as a `workflow.run` child of `"Project"` — regardless of `autoStart`. `autoStart:false` only stops the standalone workflow from auto-starting; it does NOT remove it from the run set.
- Therefore you cannot have a "clickable but manual-only" build workflow: any workflow created via `configureWorkflow` ends up in the run button. The only way to keep a build out of the run set is to NOT make it a workflow.
- Fix used: `removeWorkflow("TestFlight Build (iOS)")` so it's gone from `"Project"`, leaving a harmless dev-only child as the run target. The build is now run manually from the Shell: `pnpm --filter @workspace/ledger-mobile run tf:build`.
- The three dev servers (api-server, ledger-mobile/expo, mockup-sandbox) are artifact services (`.replit-artifact/artifact.toml`) that auto-start independently of the run button.
