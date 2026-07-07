import { Loader2 } from "lucide-react";

/**
 * Full-page branded loading state. Used as the router's defaultPendingComponent.
 */
export default function LoadingScreen({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 font-sans">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px circle at 20% 0%, rgba(31,111,235,.16), transparent 45%), radial-gradient(500px circle at 85% 100%, rgba(31,111,235,.10), transparent 45%)",
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* pulsing brand mark with spinner ring */}
        <div className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/20" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-blue-800 text-2xl font-extrabold text-white shadow-sm">
            N
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {label}
        </div>
      </div>
    </div>
  );
}
