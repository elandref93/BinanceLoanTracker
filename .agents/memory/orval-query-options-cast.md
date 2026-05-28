---
name: Orval-generated query options need a cast for partial `enabled`
description: Orval's `options.query` field is typed as full `UseQueryOptions` (queryKey required). Passing just `{enabled}` triggers TS2741. Use `as never` or supply the queryKey.
---

The hooks orval generates look like:

```ts
useGetX(params, options?: { query?: UseQueryOptions<...> })
```

But `UseQueryOptions` here is the FULL TanStack shape with `queryKey` required, not `Partial<UseQueryOptions>`. Passing the common `{ query: { enabled: someFlag } }` triggers `TS2741: Property 'queryKey' is missing`.

**Why:** Forces every consumer to either reach into the generator config or work around the type. Orval has a setting (`mutationOptions`/`queryOptions` partial mode) but it changes the whole client surface.

**How to apply (lightweight, local):** Cast the inner options object — the runtime merges fine because the generated hook fills in queryKey/queryFn internally:

```ts
useGetX(params, { query: { enabled: cond } as never })
```

Add a brief comment so the next reader doesn't try to "fix" the cast. This is fine for `enabled`, `staleTime`, `gcTime`, `refetchOnWindowFocus` and similar UI-only knobs.

Don't do this when supplying real callbacks (`onSuccess`, `select`, etc.) where the type really matters — instead, spread the generated `getGetXQueryOptions(params)` and overlay.
