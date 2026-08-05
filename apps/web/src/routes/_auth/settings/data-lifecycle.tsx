import { useEffect, useState } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { toast } from "sonner";

import {
  LegalHoldControl,
  useOrganizationHoldStatus,
} from "@/components/lifecycle/legal-hold-control";
import { LegalHoldTable } from "@/components/lifecycle/legal-hold-table";
import { TrashedSpaces } from "@/components/lifecycle/trashed-spaces";
import { PermissionGate } from "@/components/settings/permission-gate";
import { RetentionConfirmDialog } from "@/components/settings/retention-confirm-dialog";
import { describeRetention, RetentionForm } from "@/components/settings/retention-form";
import type { RetentionPolicy } from "@/components/settings/retention-form";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { formatDateTime } from "@/lib/format";
import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const ORG_UPDATE: PermissionRequest[] = [{ organization: ["update"] }];

export const Route = createFileRoute("/_auth/settings/data-lifecycle")({
  component: () => (
    <PermissionGate permissions={ORG_UPDATE}>
      <DataLifecycle />
    </PermissionGate>
  ),
});

/**
 * Where an operator answers "how long does our data live, and what may never
 * disappear?" — the two halves of the same question, so one page.
 *
 * Saving is always confirmed, even when nothing would be deleted: the dialog is
 * where the admin finds out *whether* anything would be, and a form that
 * sometimes asks and sometimes does not is a form nobody trusts.
 */
function DataLifecycle() {
  const queryClient = useQueryClient();
  const { auth } = useRouteContext({ from: "/_auth" });
  const nameOf = (userId: string | null) => {
    if (!userId) return "—";
    return (
      auth.organization.members.find((member) => member.user.id === userId)?.user.name ??
      "Unbekannt"
    );
  };

  const settingsQuery = useQuery(orpc.retention.get.queryOptions({ input: {} }));
  const orgHold = useOrganizationHoldStatus();

  const [draft, setDraft] = useState<RetentionPolicy | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Seed once the server value lands, and again when it changes underneath us
  // (another admin saving, or a refetch after our own save).
  useEffect(() => {
    if (!settingsQuery.data) return;
    const { auditRetentionDays, trashRetentionDays } = settingsQuery.data;
    setDraft({ auditRetentionDays, trashRetentionDays });
  }, [settingsQuery.data]);

  const save = useMutation(
    orpc.retention.update.mutationOptions({
      onSuccess: async () => {
        // The trash view shows expiry dates derived from this policy.
        await queryClient.invalidateQueries({ queryKey: orpc.retention.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.trash.key() });
        setConfirmOpen(false);
        toast.success("Aufbewahrungsfristen gespeichert");
      },
      onError: toastError,
    }),
  );

  if (settingsQuery.isPending || !draft) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const stored = settingsQuery.data;
  const dirty =
    !stored ||
    stored.auditRetentionDays !== draft.auditRetentionDays ||
    stored.trashRetentionDays !== draft.trashRetentionDays;

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Aufbewahrungsfristen"
        description="Wie lange Daten in dieser Organisation leben. Ein Aufräum-Lauf setzt die Fristen regelmäßig im Hintergrund durch."
      >
        <SettingsCard>
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty && !save.isPending) setConfirmOpen(true);
            }}
          >
            <RetentionForm value={draft} onChange={setDraft} disabled={save.isPending} />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{describeRetention(draft)}</p>
                <p className="text-xs text-muted-foreground">
                  {stored?.lastPurgeAt
                    ? `Letzter Lauf: ${formatDateTime(stored.lastPurgeAt)}`
                    : "Noch kein Lauf durchgeführt."}
                </p>
              </div>
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
                {save.isPending ? "Speichern …" : "Speichern"}
              </Button>
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Löschsperren"
        description="Eine Sperre verhindert jedes Löschen des Objekts — manuell wie automatisch. Sie wirkt auch auf alles, was darunter liegt: Seiten, Kommentare, Anhänge und Protokolleinträge."
        action={
          <LegalHoldControl
            subject="organization"
            subjectLabel={auth.organization.name}
            status={orgHold}
          />
        }
      >
        <LegalHoldTable organizationName={auth.organization.name} />
      </SettingsSection>

      <SettingsSection
        title="Gelöschte Bereiche"
        description="Bereiche im Papierkorb. Nach Ablauf der Frist werden sie samt Inhalten und Anhängen endgültig entfernt."
      >
        <TrashedSpaces nameOf={nameOf} />
      </SettingsSection>

      <RetentionConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        policy={draft}
        pending={save.isPending}
        onConfirm={() => save.mutate(draft)}
      />
    </div>
  );
}
