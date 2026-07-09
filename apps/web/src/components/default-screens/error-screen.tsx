import { Button } from "@nilovon-wiki/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Home, RefreshCw, TriangleAlert } from "lucide-react";

import StatusScreen from "./status-screen";

/**
 * Full-page error state. Used as the router's defaultErrorComponent.
 * `reset` retries the failed route render; a full reload is offered as fallback.
 */
export default function ErrorScreen({ error, reset }: { error?: Error; reset?: () => void }) {
  const detail = error?.message?.trim();

  return (
    <StatusScreen
      icon={<TriangleAlert className="size-7" />}
      badge="Fehler 500"
      title="Da ist etwas schiefgelaufen"
      message="Beim Laden dieser Seite ist ein unerwarteter Fehler aufgetreten. Versuch es erneut – wenn das Problem bestehen bleibt, wende dich an dein Team."
    >
      {detail && (
        <pre className="mb-1 w-full max-w-sm overflow-auto rounded-xl border border-border bg-muted/60 p-3 text-left font-mono text-[12px] leading-relaxed text-muted-foreground">
          {detail}
        </pre>
      )}
      <Button
        onClick={() => {
          if (reset) reset();
          else window.location.reload();
        }}
      >
        <RefreshCw /> Erneut versuchen
      </Button>
      <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
        <Home /> Zur Startseite
      </Button>
    </StatusScreen>
  );
}
