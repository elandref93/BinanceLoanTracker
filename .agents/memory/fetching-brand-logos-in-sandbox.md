---
name: Fetching brand/exchange logos in the sandbox
description: Which logo sources work from the code_execution sandbox and how to render them in the Expo app.
---

When you need a real brand/exchange logo (e.g. Binance, Luno) as a small square icon:

- **Google favicon service works** and returns a clean square PNG brand mark: `https://www.google.com/s2/favicons?domain=<domain>&sz=128`. This was the reliable winner.
- **Clearbit (`logo.clearbit.com`) fails** — DNS/fetch blocked in the sandbox.
- `imageSearch` results are fine but most logo results are **wordmarks** (wide aspect), which are illegible at badge size; favicons give you the icon-only mark.
- `AbortSignal.timeout(...)` inside `fetch` silently aborted every download in one run — drop it and rely on plain `fetch` if downloads come back empty.

**How to apply:** save the PNG into `artifacts/ledger-mobile/assets/images/`, then `require("../assets/images/<file>.png")` from a component (relative path, not the `@/` alias for static image requires) and render with `<Image resizeMode="contain">`, with a colored-dot fallback on `onError`.
