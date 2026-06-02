---
name: react-native-svg NaN/Infinity native crash
description: Why bad numeric data in charts hard-crashes the Expo app, and the sanitize-at-the-edge invariant that prevents it.
---

# react-native-svg crashes natively on NaN/Infinity coordinates

A `NaN` or `Infinity` passed into any react-native-svg coordinate / dash prop
(path `d`, `cx/cy`, `strokeDasharray`, `strokeDashoffset`, `x1/y1`…) causes a
**native** crash that the JS error boundary in `app/_layout.tsx` does NOT catch.
This presents as the app "crashing every now and then" — only when the data that
feeds a chart happens to be bad.

**Why:** Bad numbers originate upstream and flow silently into charts:
- `utils/risk.ts` divide-by-zero — a cross-margin / pooled-collateral loan can
  report `collateral.qty === 0`, so `priceAtLtv` / `currentCollateralPrice`
  yield `Infinity`/`NaN`, which then feed `RiskGauge` and the price rows.
- Rate-history series can contain a non-finite sample → `Sparkline` path coord.
- `.toFixed` on `undefined` (a transiently-missing API field) throws in JS
  formatters, blanking the whole screen even when SVG isn't involved.

**How to apply:** Sanitize at the edge. Any value reaching an SVG prop or a
`.toFixed` must be coerced to a finite number first.
- `utils/format.ts` formatters return `"—"` (and `groupWithSpaces` coerces to 0)
  for non-finite input instead of throwing or rendering `"NaN"/"$Infinity"`.
- `risk.ts` price helpers guard `qty<=0`, `targetLtv<=0`, `now<=0` → return 0.
- Chart components drop/clamp non-finite values: `Sparkline` filters `values`/
  `overlay`/`reference`; `RiskGauge` clamps `ltv`; `DonutChart` coerces segment
  values via a local `safe()`.
Prefer a single shared `finiteOr` helper if a new SVG component is added.

Production crash visibility is limited: `lib/crashReporting.ts` is a console-only
shim (no Sentry DSN wired), and the backend runs on Azure (not Replit), so
`fetch_deployment_logs` is empty. Native SVG crashes won't surface anywhere
remotely — the fix is prevention, not reporting.
