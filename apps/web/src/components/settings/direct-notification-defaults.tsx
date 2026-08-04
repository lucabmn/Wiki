import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import {
  DirectNotificationForm,
  type DirectNotificationPreferences,
} from "./direct-notification-form";
import { SettingsCard, SettingsSection } from "./settings-section";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";

/**
 * The organization-wide defaults for mentions and replies. Everyone who never
 * set their own follows these, so a change here reaches members who have never
 * opened their settings — which is the point of the defaults.
 */
export function DirectNotificationDefaults() {
  const queryClient = useQueryClient();
  const query = useQuery(
    orpc.notifications.direct.getOrganizationDefaults.queryOptions({ input: {} }),
  );

  const save = useMutation(
    orpc.notifications.direct.updateOrganizationDefaults.mutationOptions({
      onSuccess: async () => {
        // The personal tab renders what it inherits from here.
        await queryClient.invalidateQueries({ queryKey: orpc.notifications.direct.key() });
        toast.success("Standard gespeichert");
      },
      onError: toastError,
    }),
  );

  if (query.isPending || !query.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const defaults = query.data;
  const patch = (next: Partial<DirectNotificationPreferences & { allowUserOverride: boolean }>) => {
    if (save.isPending) return;
    save.mutate(next);
  };

  return (
    <SettingsSection
      title="Erwähnungen & Antworten"
      description="Gilt für alle, die nichts Eigenes eingestellt haben."
    >
      <SettingsCard>
        <DirectNotificationForm
          idPrefix="org-direct"
          value={defaults}
          onChange={patch}
          disabled={save.isPending}
        />

        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <label htmlFor="org-direct-allow-override" className="min-w-0 cursor-pointer">
            <span className="block text-sm font-medium">Eigene Einstellungen erlauben</span>
            <span className="block text-xs text-muted-foreground">
              Aus: alle folgen strikt diesen Vorgaben. Bereits gespeicherte persönliche
              Einstellungen bleiben erhalten und greifen wieder, sobald du es erneut erlaubst.
            </span>
          </label>
          <Switch
            id="org-direct-allow-override"
            className="mt-1 shrink-0"
            checked={defaults.allowUserOverride}
            disabled={save.isPending}
            onCheckedChange={(next) => patch({ allowUserOverride: Boolean(next) })}
          />
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
