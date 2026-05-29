---
name: external_url screenshot caching
description: Why a re-rendered mockup/page can still look stale in screenshots, and how to force a fresh capture.
---

The `screenshot` tool with `type: external_url` serves a cached capture per URL — after restarting the dev server or fixing code, the screenshot can come back **pixel-identical and stale**.

**Why:** the external screenshot/rehost service caches by exact URL, independent of the live app.

**How to apply:** append a throwaway query param (`?v=2`, `?v=3`, …) to bust the cache and get a true fresh render. A pixel-identical screenshot across two server restarts is the tell-tale sign you're looking at a cached image, not the live page.
