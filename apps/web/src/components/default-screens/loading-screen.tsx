import { Loader2 } from "lucide-react";

/**
 * Full-page branded loading state. Used as the router's defaultPendingComponent.
 */
export default function LoadingScreen({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center bg-background px-6 font-sans">
      <div className="relative flex flex-col items-center">
        {/* brand mark */}
        <div className="flex size-13 items-center justify-center rounded-xl bg-primary font-serif text-2xl font-semibold text-primary-foreground shadow-sm">
          N
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {label}
        </div>
      </div>
    </div>
  );
}
