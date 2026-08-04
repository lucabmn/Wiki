import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";

/** How often the badge re-checks. Long enough to be cheap, short enough to feel live. */
const BADGE_POLL_MS = 60_000;

/** Everything the inbox shows is derived from these queries. */
export function useInboxKey() {
  return orpc.inbox.key();
}

export function useUnreadCount() {
  return useQuery({
    ...orpc.inbox.unreadCount.queryOptions({ input: {} }),
    refetchInterval: BADGE_POLL_MS,
    // A stale badge is the one thing users notice, so refresh on return.
    refetchOnWindowFocus: true,
  });
}

export function useInboxList(options: { onlyUnread: boolean; limit: number; enabled?: boolean }) {
  return useQuery({
    ...orpc.inbox.list.queryOptions({
      input: { onlyUnread: options.onlyUnread, limit: options.limit },
    }),
    enabled: options.enabled ?? true,
  });
}

/** Mark one row read, or every row at once. Both refresh the badge. */
export function useInboxMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.inbox.key() });

  const markRead = useMutation(
    orpc.inbox.markRead.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );
  const markAllRead = useMutation(
    orpc.inbox.markAllRead.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );
  return { markRead, markAllRead };
}
