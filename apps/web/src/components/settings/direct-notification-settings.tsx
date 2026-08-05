import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import {
  DirectNotificationForm,
  type DirectNotificationPreferences,
} from "./direct-notification-form";
import { SettingsCard, SettingsSection } from "./settings-section";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * The member's own view of directed notifications.
 *
 * Two switches, saved the moment they are flipped — there is nothing to
 * compose here, so a save button would only add a step to forget. Flipping one
 * switch overrides that switch alone: the other keeps following the
 * organization's default, which is what "no stored value = inherit" buys.
 */
export function DirectNotificationSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(
    orpc.notifications.direct.getMySettings.queryOptions({ input: {} }),
  );
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.notifications.direct.key() });

  const save = useMutation(
    orpc.notifications.direct.updateMySettings.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Benachrichtigungen gespeichert");
      },
      onError: toastError,
    }),
  );

  const reset = useMutation(
    orpc.notifications.direct.resetMySettings.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Du folgst wieder den Vorgaben der Organisation");
      },
      onError: toastError,
    }),
  );

  if (settingsQuery.isPending || !settingsQuery.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const settings = settingsQuery.data;
  const busy = save.isPending || reset.isPending;
  const hasOwn = settings.override !== null;

  const patch = (next: DirectNotificationPreferences) => {
    if (busy || !settings.canOverride) return;
    // Send the stored override, with only the switch that moved made explicit —
    // so the untouched one keeps inheriting later changes to the default.
    save.mutate({
      mentions:
        next.mentions === settings.effective.mentions ? settings.override?.mentions : next.mentions,
      commentReplies:
        next.commentReplies === settings.effective.commentReplies
          ? settings.override?.commentReplies
          : next.commentReplies,
    });
  };

  return (
    <SettingsSection
      title="Erwähnungen & Antworten"
      description="Landet in deinem Posteingang, sobald es passiert — unabhängig von der Zusammenfassung."
      action={
        hasOwn ? (
          <Badge variant="secondary">Eigene Einstellungen</Badge>
        ) : (
          <Badge variant="outline">Vorgabe der Organisation</Badge>
        )
      }
    >
      <SettingsCard>
        {!settings.canOverride ? (
          <Alert>
            <Lock />
            <AlertTitle>Von der Organisation vorgegeben</AlertTitle>
            <AlertDescription>
              In dieser Organisation sind eigene Einstellungen dafür deaktiviert.
            </AlertDescription>
          </Alert>
        ) : null}

        <DirectNotificationForm
          idPrefix="me-direct"
          value={settings.effective}
          onChange={patch}
          disabled={!settings.canOverride || busy}
        />

        {hasOwn && settings.canOverride ? (
          <div className="flex justify-end border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => reset.mutate({})}
            >
              Vorgabe übernehmen
            </Button>
          </div>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
