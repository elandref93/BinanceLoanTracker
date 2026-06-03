---
name: Running EAS builds from the Replit main agent
description: The main-agent sandbox blocks git writes, so eas build needs EAS_NO_VCS=1.
---

# `eas build` from the main agent must use `EAS_NO_VCS=1`

EAS CLI packages the project by creating a git archive, which writes
`.git/index.lock`. The Replit main-agent bash sandbox blocks ALL writes under
`.git/` (it reports "Destructive git operations are not allowed in the main
agent"), so a plain `eas build` (e.g. the `tf:build` script) fails with an
`index.lock` error. Even `rm -f .git/index.lock` is blocked.

**Fix:** run the build with `EAS_NO_VCS=1`, which makes EAS archive the working
tree directly (respecting `.easignore`/`.gitignore`) and skip git entirely:

    cd artifacts/ledger-mobile && EAS_NO_VCS=1 pnpm exec eas build \
      -p ios --profile production --non-interactive --auto-submit --no-wait

**Why this is safe here:** keep the working tree clean (everything committed)
before building, so the no-VCS archive == HEAD. `appVersionSource: "remote"` +
`autoIncrement` get the build number from EAS servers, not git.

**Side effect to know:** a failed pre-`EAS_NO_VCS` attempt can leave a stale
empty `.git/index.lock` that the main agent cannot delete. `EAS_NO_VCS=1` builds
still work despite it, but normal git tooling in the sandbox may complain until
the platform/user clears the lock.

**Build secrets:** EAS source-map upload needs `SENTRY_AUTH_TOKEN` in the EAS
build env. Store it as a project env var with `--visibility secret` in the
`production` environment (`eas env:create`), not in eas.json. Non-development
build profiles default to the `production` EAS environment, so no `environment`
field is needed in the profile.
