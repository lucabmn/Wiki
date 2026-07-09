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
