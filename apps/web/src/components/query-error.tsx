import { friendlyErrorMessage } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { AlertCircle, RefreshCw } from "lucide-react";

/**
 * Inline error state for failed queries. Renders instead of the usual empty
 * state so a fetch failure doesn't masquerade as "no data", and offers a
 * retry right where the content should be (the global toast is transient).
 * `compact` is for tight surfaces like the sidebar or command palette.
 */
export function QueryError({
  onRetry,
  error,
  className,
  compact = false,
}: {
  onRetry: () => void;
  error?: Error | null;
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-muted-foreground",
          className,
        )}
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">Konnte nicht geladen werden.</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium text-primary hover:text-primary/80"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center",
        className,
      )}
    >
      <AlertCircle className="size-6 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Konnte nicht geladen werden.</p>
        {error ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{friendlyErrorMessage(error)}</p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Erneut versuchen
      </Button>
    </div>
  );
}
