import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { History, MoreHorizontal, Plus, Send, Webhook as WebhookIcon } from "lucide-react";
import { toast } from "sonner";

import { orpc, client } from "@/utils/orpc";
import { toastError, useInvalidate } from "@/lib/query";
import { ACTION_LABEL } from "@/lib/labels";
import { PermissionGate } from "@/components/settings/permission-gate";
import { SettingsSection } from "@/components/settings/settings-section";
import { StatusBadge, WebhookDeliveriesSheet } from "@/components/settings/webhook-deliveries";
import { WebhookDialog, type Webhook } from "@/components/settings/webhook-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nilovon-wiki/ui/components/alert-dialog";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const ORG_UPDATE: PermissionRequest[] = [{ organization: ["update"] }];

export const Route = createFileRoute("/_auth/settings/webhooks")({
  component: () => (
    <PermissionGate permissions={ORG_UPDATE}>
      <WebhookSettings />
    </PermissionGate>
  ),
});

/**
 * Outbound webhooks: what leaves this wiki, and where it goes.
 *
 * Each card shows the outcome of the last attempt, because the question an admin
 * comes here with is almost never "what did I configure" but "is it still
 * working" — the full log is one click away behind it.
 */
function WebhookSettings() {
  const webhooksQuery = useQuery(orpc.webhooks.list.queryOptions({ input: {} }));
  const invalidate = useInvalidate(orpc.webhooks.key());
  const webhooks = webhooksQuery.data ?? [];

  // `undefined` = closed, `null` = create, webhook = edit. Same tri-state the
  // SSO tab uses, so the dialog mounts once and never flashes empty on close.
  const [editorTarget, setEditorTarget] = useState<Webhook | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);
  const [logTarget, setLogTarget] = useState<Webhook | null>(null);

  return (
    <SettingsSection
      title="Webhooks"
      description="Schickt Ereignisse aus diesem Wiki an andere Systeme — Slack, Teams, Jira oder eure eigene Automatisierung."
      action={
        webhooks.length > 0 ? (
          <Button size="sm" onClick={() => setEditorTarget(null)}>
            <Plus className="size-4" /> Webhook
          </Button>
        ) : null
      }
    >
      {webhooksQuery.isPending ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : webhooks.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WebhookIcon />
            </EmptyMedia>
            <EmptyTitle>Noch kein Webhook eingerichtet</EmptyTitle>
            <EmptyDescription>
              Ein Webhook meldet ausgewählte Ereignisse per HTTP-POST an eine Adresse eurer Wahl —
              signiert, damit der Empfänger prüfen kann, dass sie wirklich von hier kommen.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setEditorTarget(null)}>
              <Plus className="size-4" /> Webhook anlegen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <WebhookCard
              key={webhook.id}
              webhook={webhook}
              onEdit={() => setEditorTarget(webhook)}
              onDelete={() => setDeleteTarget(webhook)}
              onShowLog={() => setLogTarget(webhook)}
              onTested={invalidate}
            />
          ))}
        </div>
      )}

      <WebhookDialog
        open={editorTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditorTarget(undefined);
        }}
        existing={editorTarget ?? null}
        onSaved={invalidate}
      />

      <WebhookDeliveriesSheet
        webhookId={logTarget?.id ?? null}
        webhookName={logTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setLogTarget(null);
        }}
      />

      <DeleteWebhookDialog
        webhook={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={invalidate}
      />
    </SettingsSection>
  );
}

function WebhookCard({
  webhook,
  onEdit,
  onDelete,
  onShowLog,
  onTested,
}: {
  webhook: Webhook;
  onEdit: () => void;
  onDelete: () => void;
  onShowLog: () => void;
  onTested: () => void;
}) {
  const test = useMutation({
    mutationFn: () => client.webhooks.test({ id: webhook.id }),
    onSuccess: (result) => {
      onTested();
      if (result.ok) toast.success(`Testereignis zugestellt (HTTP ${result.responseStatus}).`);
      // Not a toast.error: the request itself worked, the receiver did not. The
      // reason is what the admin needs, so it is shown in full.
      else toast.warning(`Testereignis nicht angekommen: ${result.error ?? "unbekannter Fehler"}`);
    },
    onError: toastError,
  });

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{webhook.name}</span>
            {webhook.active ? null : <Badge variant="outline">Pausiert</Badge>}
            {webhook.lastDelivery ? (
              <StatusBadge
                status={webhook.lastDelivery.status}
                responseStatus={webhook.lastDelivery.responseStatus}
              />
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">{webhook.url}</div>
          <div className="text-xs text-muted-foreground">
            {webhook.spaceName ? `Space „${webhook.spaceName}"` : "Alle Spaces"} ·{" "}
            {webhook.secretPreview}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            <Send className="size-4" /> {test.isPending ? "Sende …" : "Test"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" title="Aktionen">
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Aktionen</span>
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onShowLog}>
                <History className="size-4" /> Zustellungen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Bearbeiten</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                Entfernen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {webhook.events.map((event) => (
          <Badge key={event} variant="outline" className="font-normal">
            {ACTION_LABEL[event] ?? event}
          </Badge>
        ))}
      </div>

      {webhook.lastDelivery?.lastError ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs break-all">
          Letzter Versuch: {webhook.lastDelivery.lastError}
        </p>
      ) : null}
    </Card>
  );
}

function DeleteWebhookDialog({
  webhook,
  onClose,
  onDeleted,
}: {
  webhook: Webhook | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: (id: string) => client.webhooks.delete({ id }),
    onSuccess: () => {
      onDeleted();
      toast.success("Webhook entfernt");
      onClose();
    },
    onError: toastError,
  });

  return (
    <AlertDialog
      open={webhook !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>„{webhook?.name}" entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            Es werden keine Ereignisse mehr an diese Adresse geschickt, und die Zustellhistorie wird
            mitgelöscht. Zum vorübergehenden Stoppen reicht „Bearbeiten → Aktiv aus".
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              if (webhook) remove.mutate(webhook.id);
            }}
          >
            {remove.isPending ? "Entfernen …" : "Entfernen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
