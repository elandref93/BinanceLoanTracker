---
name: Ledger portfolio data constraints
description: Non-obvious backend/data limits behind the consolidated Binance+Luno Portfolio screen.
---

The Portfolio screen (mobile `app/(tabs)/crypto.tsx`) merges Binance holdings (server-valued via `/holdings` + `useListHoldings`) with Luno wallets (priced client-side). Per-asset USD split = Binance value (`m.binance.usd`) plus the remainder treated as Luno.

- **Binance has NO general transaction endpoint** — only interest/earn history. So per-asset Binance transactions cannot be shown without new, deploy-gated backend work. Luno transactions do exist. The tx list is therefore Luno-only ("ALL TRANSACTIONS · LUNO").
  **Why:** avoids re-investigating "where are the Binance transactions" each session.

- **Portfolio composition must NOT depend on the display currency.** Exclude only true fiat cash (Luno's `ZAR` wallet, shown in the cash tile) from the merged list — never `sym === currency`, or a USD-denominated holding silently vanishes when viewing in USD. USD/ZAR is a *formatting* toggle (`fmtMoney`), not a filter.
  **Why:** earlier code filtered by `sym === currency`; flagged in review as a correctness bug.

- Spot holdings only appear once the **Azure backend is redeployed** (prod `/api/healthz` lacking a `version` field = stale build). Redeploy steps live in `artifacts/api-server/AZURE.md`; not doable from this container (no Azure creds).
