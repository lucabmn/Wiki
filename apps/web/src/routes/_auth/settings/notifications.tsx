import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Inbox, Lock, MailX } from "lucide-react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import {
  DigestForm,
  describeSchedule,
  type DigestPreferences,
} from "@/components/settings/digest-form";
import { DirectNotificationSettings } from "@/components/settings/direct-notification-settings";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/settings/notifications")({
  component: NotificationSettings,
});

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * The member's own view of bundled notifications.
 *
 * Two states, deliberately explicit rather than implied by whether the values
 * happen to differ: "follow the organization" (no stored row) and "own
 * settings". Switching back to the first *deletes* the override, so later
 * changes to the defaults reach this member again.
 */
function NotificationSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpc.notifications.getMySettings.queryOptions({ input: {} }));

  const [draft, setDraft] = useState<DigestPreferences | null>(null);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setDraft(settingsQuery.data.effective);
    setCustom(settingsQuery.data.override?.mode === "custom");
  }, [settingsQuery.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.notifications.key() });

  const save = useMutation(
    orpc.notifications.updateMySettings.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Benachrichtigungen gespeichert");
      },
      onError: toastError,
    }),
  );

  const reset = useMutation(
    orpc.notifications.resetMySettings.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Du folgst wieder den Vorgaben der Organisation");
      },
      onError: toastError,
    }),
  );

  if (settingsQuery.isPending || !draft || !settingsQuery.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const settings = settingsQuery.data;
  const busy = save.isPending || reset.isPending;
  const canonical = (preferences: DigestPreferences) =>
    JSON.stringify({ ...preferences, categories: [...preferences.categories].sort() });
  const dirty =
    custom !== (settings.override?.mode === "custom") ||
    (custom && canonical(draft) !== canonical(settings.effective));

  return (
    <div className="space-y-8">
      {!settings.mailConfigured ? (
        <Alert>
          <MailX />
          <AlertTitle>Kein E-Mail-Versand eingerichtet</AlertTitle>
          <AlertDescription>
            Auf diesem Server ist kein SMTP-Zugang hinterlegt, daher werden Zusammenfassungen nicht
            verschickt. Deine Einstellungen bleiben gespeichert und greifen, sobald der Versand
            eingerichtet ist.
          </AlertDescription>
        </Alert>
      ) : null}

      <DirectNotificationSettings />

      <SettingsSection
        title="Gebündelte Benachrichtigungen"
        description="Eine Zusammenfassung per E-Mail statt einer Mail pro Änderung."
        action={
          settings.override?.mode === "custom" ? (
            <Badge variant="secondary">Eigene Einstellungen</Badge>
          ) : (
            <Badge variant="outline">Vorgabe der Organisation</Badge>
          )
        }
      >
        <SettingsCard>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-4" />
                {settings.nextRunAt
                  ? `Nächste Zusammenfassung: ${dateTime.format(new Date(settings.nextRunAt))}`
                  : "Aktuell ist keine Zusammenfassung geplant."}
              </span>
              {settings.lastSentAt ? (
                <span className="flex items-center gap-1.5">
                  <Inbox className="size-4" />
                  Zuletzt verschickt: {dateTime.format(new Date(settings.lastSentAt))}
                </span>
              ) : null}
            </div>

            {!settings.canOverride ? (
              <Alert>
                <Lock />
                <AlertTitle>Von der Organisation vorgegeben</AlertTitle>
                <AlertDescription>
                  {describeSchedule(settings.effective)} — eigene Einstellungen sind hier
                  deaktiviert.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={custom ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => {
                    setCustom(false);
                    setDraft(settings.organization);
                  }}
                >
                  Vorgabe übernehmen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={custom ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => setCustom(true)}
                >
                  Selbst festlegen
                </Button>
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={custom ? "Deine Einstellungen" : "Vorgabe der Organisation"}
        description={
          custom
            ? "Gilt nur für dich. Änderungen an der Vorgabe wirken sich dann nicht mehr auf dich aus."
            : `${describeSchedule(settings.organization)} — so ist es für die ganze Organisation eingestellt.`
        }
      >
        <SettingsCard>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!dirty || busy) return;
              // Leaving "custom" means dropping the row entirely, not storing a
              // copy of today's defaults — otherwise the member silently stops
              // following later changes to them.
              if (custom) save.mutate({ mode: "custom", ...draft });
              else reset.mutate({});
            }}
          >
            <DigestForm
              idPrefix="me"
              value={custom ? draft : settings.organization}
              onChange={setDraft}
              disabled={!custom || !settings.canOverride || busy}
            />

            {custom ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">{describeSchedule(draft)}</p>
                <Button type="submit" size="sm" disabled={!dirty || busy}>
                  {busy ? "Speichern …" : "Speichern"}
                </Button>
              </div>
            ) : dirty ? (
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? "Speichern …" : "Vorgabe übernehmen"}
                </Button>
              </div>
            ) : null}
          </form>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
