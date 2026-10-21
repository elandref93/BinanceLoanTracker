import { QueryClient } from "@tanstack/react-query";

/**
 * In-memory query cache only, for the life of the tab. Data stays for five
 * minutes after a screen unmounts so switching tabs is instant, then it is
 * dropped. Nothing here is written to localStorage, IndexedDB, or a service
 * worker — authenticated financial responses must not be persisted.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        staleTime: 30 * 1000,
        retry: (failureCount, error) => {
          const status = (error as { status?: unknown } | null)?.status;
          if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}
