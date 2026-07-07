import { Button } from "@nilovon-wiki/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileQuestion, Home } from "lucide-react";

import StatusScreen from "./status-screen";

/**
 * Full-page 404 state. Used as the router's defaultNotFoundComponent.
 */
export default function NotFoundScreen() {
  return (
    <StatusScreen
      icon={<FileQuestion className="size-7" />}
      badge="Fehler 404"
      title="Seite nicht gefunden"
      message="Diese Seite existiert nicht oder wurde verschoben. Vielleicht hilft die Suche im Hub weiter."
    >
      <Button variant="outline" onClick={() => window.history.back()}>
        <ArrowLeft /> Zurück
      </Button>
      <Button render={<Link to="/" />}>
        <Home /> Zur Startseite
      </Button>
    </StatusScreen>
  );
}
