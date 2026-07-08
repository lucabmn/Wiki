import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Shared mutation error handler — query errors already toast globally in orpc.ts. */
export const toastError = (error: Error) => toast.error(error.message);

/** Stable callback that invalidates one query key, for mutation onSuccess. */
export function useInvalidate(queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey });
}
