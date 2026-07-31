import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { MoreHorizontal, Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { teamsQueryOptions, useOrgRefresh } from "@/lib/org-queries";
import { PermissionGate } from "@/components/settings/permission-gate";
import { SettingsSection } from "@/components/settings/settings-section";
import { TeamMembersSheet, type TeamTarget } from "@/components/settings/team-members-sheet";
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
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
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
import { Field, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const TEAM_MANAGE: PermissionRequest[] = [{ team: ["create"] }];

export const Route = createFileRoute("/_auth/settings/teams")({
  component: () => (
    <PermissionGate permissions={TEAM_MANAGE}>
      <TeamsSettings />
    </PermissionGate>
  ),
});

type Team = { id: string; name: string };

function TeamsSettings() {
  const { auth } = Route.useRouteContext();
  const organizationId = auth.organization.id;
  const refresh = useOrgRefresh();

  const [editorTarget, setEditorTarget] = useState<Team | null | undefined>(undefined);
  const [membersTarget, setMembersTarget] = useState<TeamTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  const teamsQuery = useQuery(teamsQueryOptions(organizationId));
  const teams = (teamsQuery.data ?? []) as Team[];

  const remove = useMutation({
    mutationFn: async (teamId: string) => {
      const result = await authClient.organization.removeTeam({ teamId, organizationId });
      if (result.error) throw new Error(result.error.message ?? "Löschen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Team gelöscht");
      setDeleteTarget(null);
    },
    onError: toastError,
  });

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Teams"
        description="Personengruppen, die sich als Ganzes zu Spaces und Seiten hinzufügen lassen. Rechte vergibst du über Gruppen, nicht über Teams."
        action={
          <Button size="sm" onClick={() => setEditorTarget(null)}>
            <Plus className="size-4" /> Team erstellen
          </Button>
        }
      >
        {teamsQuery.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersRound />
              </EmptyMedia>
              <EmptyTitle>Noch keine Teams</EmptyTitle>
              <EmptyDescription>
                Ein Team wie „Produktion" lässt sich in einem Space mit einer Rolle hinterlegen —
                statt jede Person einzeln einzutragen.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => setEditorTarget(null)}>
                <Plus className="size-4" /> Erstes Team erstellen
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team) => (
              <Card key={team.id} className="gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{team.name}</div>
                    <button
                      type="button"
                      className="mt-0.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setMembersTarget(team)}
                    >
                      Mitglieder verwalten
                    </button>
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
                      <DropdownMenuItem onClick={() => setMembersTarget(team)}>
                        Mitglieder verwalten
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditorTarget(team)}>
                        Umbenennen
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(team)}>
                        Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            ))}
          </div>
        )}
      </SettingsSection>

      <TeamEditorDialog
        open={editorTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditorTarget(undefined);
        }}
        organizationId={organizationId}
        existing={editorTarget ?? null}
        existingNames={teams.map((team) => team.name)}
      />

      <TeamMembersSheet
        open={membersTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMembersTarget(null);
        }}
        organizationId={organizationId}
        team={membersTarget}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Team löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `„${deleteTarget.name}" wird gelöscht. Spaces und Seiten, die dieses Team als Mitglied führen, verlieren diesen Zugang.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget.id);
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

function TeamEditorDialog({
  open,
  onOpenChange,
  organizationId,
  existing,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  existing: Team | null;
  existingNames: string[];
}) {
  const refresh = useOrgRefresh();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setError(null);
    }
  }, [open, existing]);

  const save = useMutation({
    mutationFn: async (nextName: string) => {
      const result = existing
        ? await authClient.organization.updateTeam({
            teamId: existing.id,
            data: { name: nextName },
          })
        : await authClient.organization.createTeam({ name: nextName, organizationId });
      if (result.error) throw new Error(result.error.message ?? "Speichern fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success(existing ? "Team umbenannt" : "Team erstellt");
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Mindestens 2 Zeichen");
      return;
    }
    const taken = existingNames.some(
      (candidate) =>
        candidate.toLowerCase() === trimmed.toLowerCase() && candidate !== existing?.name,
    );
    if (taken) {
      setError("Ein Team mit diesem Namen existiert bereits");
      return;
    }
    setError(null);
    save.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Team umbenennen" : "Team erstellen"}</DialogTitle>
          <DialogDescription>
            Der Name erscheint überall dort, wo das Team Zugriff auf Inhalte hat.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="team-name">Name</FieldLabel>
            <Input
              id="team-name"
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Produktion"
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? "Speichern …" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
