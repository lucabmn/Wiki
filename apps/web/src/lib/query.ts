import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { friendlyErrorMessage } from "@/utils/orpc";

/** Shared mutation error handler — query errors already toast globally in orpc.ts. */
export const toastError = (error: Error) => toast.error(friendlyErrorMessage(error));

/** Stable callback that invalidates one query key, for mutation onSuccess. */
export function useInvalidate(queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey });
}

/**
 * Builds mutation callbacks that optimistically add/remove `item` from a cached
 * list keyed by `id`, so membership toggles (favorite, subscribe, …) flip
 * instantly instead of waiting on the round-trip. Snapshots the list, patches
 * it, rolls back on error, and reconciles with the server on settle.
 *
 * `listKey` is the exact query key of the list; `prefixKey` is the broader key
 * used to cancel/invalidate (matches the list plus any variants).
 */
export function useOptimisticListToggle<T extends { id: string }>(
  listKey: readonly unknown[],
  prefixKey: readonly unknown[],
) {
  const queryClient = useQueryClient();
  return (item: T, present: boolean) => ({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: prefixKey });
      const previous = queryClient.getQueryData<T[]>(listKey);
      queryClient.setQueryData<T[]>(listKey, (old = []) => {
        const without = old.filter((entry) => entry.id !== item.id);
        return present ? [item, ...without] : without;
      });
      return { previous };
    },
    onError: (error: Error, _vars: unknown, ctx: { previous?: T[] } | undefined) => {
      if (ctx?.previous !== undefined) queryClient.setQueryData(listKey, ctx.previous);
      toastError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: prefixKey }),
  });
}
