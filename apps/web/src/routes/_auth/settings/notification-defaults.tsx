import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import { PermissionGate } from "@/components/settings/permission-gate";
import { DirectNotificationDefaults } from "@/components/settings/direct-notification-defaults";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import {
  DigestForm,
  describeSchedule,
  type DigestPreferences,
} from "@/components/settings/digest-form";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";

const ORG_UPDATE: PermissionRequest[] = [{ organization: ["update"] }];

export const Route = createFileRoute("/_auth/settings/notification-defaults")({
  component: () => (
    <PermissionGate permissions={ORG_UPDATE}>
      <NotificationDefaults />
    </PermissionGate>
  ),
});

/**
 * The organization-wide defaults for bundled notifications. Every member runs
 * on these unless they set their own — so saving here moves everyone who never
 * opted out, including members who have never opened their settings.
 */
function NotificationDefaults() {
  const queryClient = useQueryClient();
  const defaultsQuery = useQuery(
    orpc.notifications.getOrganizationDefaults.queryOptions({ input: {} }),
  );

  const [draft, setDraft] = useState<DigestPreferences | null>(null);
  const [allowUserOverride, setAllowUserOverride] = useState(true);

  // Seed the form once the server value lands, and again whenever it changes
  // underneath us (another admin saving, a refetch after our own save).
  useEffect(() => {
    if (!defaultsQuery.data) return;
    const { allowUserOverride: allowOverride, ...preferences } = defaultsQuery.data;
    setDraft(preferences);
    setAllowUserOverride(allowOverride);
  }, [defaultsQuery.data]);

  const save = useMutation(
    orpc.notifications.updateOrganizationDefaults.mutationOptions({
      onSuccess: async () => {
        // The personal tab renders what it inherits from here.
        await queryClient.invalidateQueries({ queryKey: orpc.notifications.key() });
        toast.success("Standard-Benachrichtigungen gespeichert");
      },
      onError: toastError,
    }),
  );

  if (defaultsQuery.isPending || !draft) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const next = { ...draft, allowUserOverride };
  // Category order is not meaningful, so compare a canonical form — toggling a
  // box off and on again must not leave the form looking dirty.
  const canonical = (settings: typeof next) =>
    JSON.stringify({ ...settings, categories: [...settings.categories].sort() });
  const dirty = !defaultsQuery.data || canonical(defaultsQuery.data) !== canonical(next);

  return (
    <div className="space-y-8">
      <DirectNotificationDefaults />

      <SettingsSection
        title="Gebündelte Benachrichtigungen"
        description="Diese Einstellungen gelten für alle Mitglieder, die nichts Eigenes festgelegt haben."
      >
        <SettingsCard>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty && !save.isPending) save.mutate(next);
            }}
          >
            <DigestForm
              idPrefix="org"
              value={draft}
              onChange={setDraft}
              disabled={save.isPending}
            />

            <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
              <label htmlFor="org-allow-override" className="min-w-0 cursor-pointer">
                <span className="block text-sm font-medium">Eigene Einstellungen erlauben</span>
                <span className="block text-xs text-muted-foreground">
                  Aus: alle folgen strikt diesen Vorgaben. Bereits gespeicherte persönliche
                  Einstellungen bleiben erhalten und greifen wieder, sobald du es erneut erlaubst.
                </span>
              </label>
              <Switch
                id="org-allow-override"
                className="mt-1 shrink-0"
                checked={allowUserOverride}
                disabled={save.isPending}
                onCheckedChange={(next) => setAllowUserOverride(Boolean(next))}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{describeSchedule(draft)}</p>
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
                {save.isPending ? "Speichern …" : "Speichern"}
              </Button>
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
