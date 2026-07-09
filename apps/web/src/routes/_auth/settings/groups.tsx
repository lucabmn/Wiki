import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Plus, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import {
  membersQueryOptions,
  rolesQueryOptions,
  useOrgRefresh,
  type OrgRole,
} from "@/lib/org-queries";
import { summarizePermission } from "@/lib/permission-catalog";
import { GroupEditorSheet } from "@/components/settings/group-editor-sheet";
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

export const Route = createFileRoute("/_auth/settings/groups")({
  component: GroupsSettings,
});

function splitRoles(role: string | null | undefined): string[] {
  return (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function GroupCard({
  group,
  memberCount,
  onEdit,
  onDelete,
}: {
  group: OrgRole;
  memberCount: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const summary = summarizePermission(group.permission);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{group.role}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {memberCount} {memberCount === 1 ? "Mitglied" : "Mitglieder"}
          </div>
        </div>
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
            <DropdownMenuItem onClick={onEdit}>Bearbeiten</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {summary.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {summary.map((entry) => (
            <Badge
              key={entry.resource}
              variant="outline"
              className={
                entry.dangerous
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                  : undefined
              }
            >
              {entry.dangerous ? <ShieldAlert className="size-3" /> : null}
              {entry.label}: {entry.actions.join(", ")}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Keine Rechte zugewiesen.</p>
      )}
    </Card>
  );
}

function GroupsSettings() {
  const { auth } = Route.useRouteContext();
  const organizationId = auth.organization.id;
  const refresh = useOrgRefresh();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<OrgRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgRole | null>(null);

  const rolesQuery = useQuery(rolesQueryOptions(organizationId));
  const membersQuery = useQuery(membersQueryOptions(organizationId));

  const groups = rolesQuery.data ?? [];
  const members = membersQuery.data?.members ?? [];

  const memberCountFor = (roleName: string) =>
    members.filter((member) => splitRoles(member.role).includes(roleName)).length;

  const remove = useMutation({
    mutationFn: async (roleName: string) => {
      const result = await authClient.organization.deleteRole({ roleName, organizationId });
      if (result.error) throw new Error(result.error.message ?? "Löschen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Gruppe gelöscht");
      setDeleteTarget(null);
    },
    onError: toastError,
  });

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (group: OrgRole) => {
    setEditing(group);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Gruppen</h2>
          <p className="text-sm text-muted-foreground">
            Eigene Rollen mit maßgeschneiderten Rechten, zuweisbar an Mitglieder.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> Gruppe erstellen
        </Button>
      </div>

      {rolesQuery.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldAlert />
            </EmptyMedia>
            <EmptyTitle>Noch keine Gruppen</EmptyTitle>
            <EmptyDescription>
              Gruppen bündeln Rechte über die Standardrollen hinaus — etwa „Redaktion" mit dem Recht
              zu veröffentlichen.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> Erste Gruppe erstellen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              memberCount={memberCountFor(group.role)}
              onEdit={() => openEdit(group)}
              onDelete={() => setDeleteTarget(group)}
            />
          ))}
        </div>
      )}

      <GroupEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        organizationId={organizationId}
        existing={editing}
        allGroups={groups}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gruppe löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Die Gruppe „${deleteTarget.role}" wird gelöscht. Mitglieder verlieren die darüber gewährten Rechte. Diese Aktion kann nicht rückgängig gemacht werden.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget.role);
              }}
            >
              {remove.isPending ? "Löschen …" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
