---
name: orval generated query `enabled` cast
description: Why generated orval React Query hooks need a `{query:{...} as never}` cast for the options arg.
---

# Orval generated query options need `as never` on the `query` option

When calling a generated orval React Query hook (e.g. `useGetRateHistory(params, options)`)
and passing query options like `enabled`, the options object must be cast:

```ts
useGetRateHistory({ loanId, days }, { query: { enabled: !!id } as never });
```

**Why:** the generated option type makes `queryKey` required on the `query`
object, so passing `{ query: { enabled } }` without it fails with TS2741
("queryKey is missing"). The hook supplies a default queryKey at runtime, so the
cast is safe — it just silences the over-strict generated type.

**How to apply:** any time you pass `enabled`/`staleTime`/etc. to a generated
`useGet*`/`useList*` hook in `lib/api-client-react`, wrap the inner `query`
object with `as never` (or otherwise satisfy/cast the type). Regenerating
codegen does not change this.
