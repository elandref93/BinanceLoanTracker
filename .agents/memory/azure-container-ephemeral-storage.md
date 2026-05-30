---
name: Azure App Service container ephemeral storage
description: Why disk-backed per-user sync data vanishes on the Azure-deployed api-server, and how to keep it.
---

# Azure App Service (Linux containers) wipes the filesystem

The Ledger api-server is deployed to Azure App Service as a Docker container
(see `artifacts/api-server/AZURE.md`). On Azure Linux **containers** the
filesystem is ephemeral — anything written under the app dir is destroyed on
every restart/redeploy. Azure persists **only `/home`**, and only when the app
setting `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` is set.

**Why this matters:** cross-device sync (accounts + settings) stores per-user
JSON blobs on disk. If they land outside `/home` (or the flag is off), a second
device signs in, the server returns 404, and the user sees empty data — while
the first device still looks fine because it has a local copy. This is silent
data loss that only shows up on a fresh/second device.

**How to apply:**
- Storage path must live under `/home` on Azure. The server auto-targets
  `/home/data/account_sync` when it detects Azure (env `WEBSITE_INSTANCE_ID`);
  `ACCOUNT_SYNC_DIR` overrides.
- Production needs `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` AND a container
  redeploy (`az acr build` + `az webapp restart`) for any server change to take
  effect — the running container does not hot-reload.
- Per-user write locks in the sync routes are **per-process only**; they do not
  serialize across multiple Azure instances sharing `/home`. Fine for the
  current single-instance 3-user app; revisit if scaled out.
