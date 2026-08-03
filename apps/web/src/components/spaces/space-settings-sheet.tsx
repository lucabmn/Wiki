import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Download, Globe, Lock, Users } from "lucide-react";
import { toast } from "sonner";

import { MemberAccessManager } from "@/components/access/member-access-manager";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { VISIBILITY_LABEL } from "@/lib/labels";
import { spaceExportUrl } from "@/lib/space-export";
import { env } from "@nilovon-wiki/env/web";
import { membersQueryOptions, rolesQueryOptions } from "@/lib/org-queries";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
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
import { Input } from "@nilovon-wiki/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { cn } from "@nilovon-wiki/ui/lib/utils";

// Ordered from open to closed, which is how the cards read top to bottom.
const VISIBILITIES = ["public", "restricted", "private"] as const;

const VISIBILITY_HINT: Record<string, string> = {
  public: "Jedes Organisationsmitglied kann lesen. Schreiben braucht eine Rolle.",
  private: "Nur explizite Mitglieder haben Zugriff.",
  restricted: "Ersteller und explizite Mitglieder haben Zugriff.",
};

const VISIBILITY_ICON = { public: Globe, restricted: Users, private: Lock } as const;

// Preset accents matching the hex format the API validates.
const SPACE_COLORS = [
  DEFAULT_SPACE_COLOR,
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#16A34A",
  "#0D9488",
  "#64748B",
] as const;

export function SpaceSettingsSheet({
  open,
  onOpenChange,
  space,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: { id: string; name: string; visibility: string; color: string | null };
  organizationId: string;
}) {
  const navigate = useNavigate();
  const invalidateMembers = useInvalidate(orpc.spaceMembers.list.key());
  const invalidateSpaces = useInvalidate(orpc.spaces.list.key());
  const invalidateMyRole = useInvalidate(orpc.spaceMembers.myRole.key());

  const membersQuery = useQuery(
    orpc.spaceMembers.list.queryOptions({ input: { spaceId: space.id }, enabled: open }),
  );
  const orgMembersQuery = useQuery({ ...membersQueryOptions(organizationId), enabled: open });
  const groupsQuery = useQuery({ ...rolesQueryOptions(organizationId), enabled: open });

  const members = membersQuery.data ?? [];
  const orgMembers = orgMembersQuery.data?.members ?? [];
  const groups = groupsQuery.data ?? [];
  const memberUserIds = new Set(members.map((m) => m.user?.id).filter(Boolean));
  const grantedRoleNames = new Set(members.map((m) => m.roleName).filter(Boolean));
  const addableUsers = orgMembers.filter((m) => !memberUserIds.has(m.user.id));
  const addableGroups = groups.filter((g) => !grantedRoleNames.has(g.role));

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Draft for the "Allgemein" section; re-seeded from the space each time the
  // sheet opens (and after a save, when the fresh space props arrive).
  const [name, setName] = useState(space.name);
  const [color, setColor] = useState<string | null>(space.color);
  // The visibility cards switch on click, before the mutation resolves —
  // otherwise the selection appears stuck. Reverted in the mutation's onError.
  const [visibility, setVisibility] = useState(space.visibility);
  useEffect(() => {
    if (open) {
      setName(space.name);
      setColor(space.color);
      setVisibility(space.visibility);
    }
  }, [open, space.name, space.color, space.visibility]);

  const refresh = () => {
    invalidateMembers();
    invalidateMyRole();
  };

  const updateGeneral = useMutation(
    orpc.spaces.update.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        toast.success("Space aktualisiert");
      },
      onError: toastError,
    }),
  );

  const updateVisibility = useMutation(
    orpc.spaces.update.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        invalidateMyRole();
        toast.success("Sichtbarkeit aktualisiert");
      },
      onError: (error) => {
        setVisibility(space.visibility);
        toastError(error);
      },
    }),
  );

  const archiveSpace = useMutation(
    orpc.spaces.archive.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        setConfirmArchive(false);
        onOpenChange(false);
        toast.success("Space archiviert");
        // Archived spaces drop out of the default list, so the slug route
        // would show "nicht gefunden" — send the user back to the overview.
        navigate({ to: "/spaces" });
      },
      onError: toastError,
    }),
  );

  const deleteSpace = useMutation(
    orpc.spaces.delete.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        setConfirmDelete(false);
        onOpenChange(false);
        toast.success("Space gelöscht");
        navigate({ to: "/spaces" });
      },
      onError: toastError,
    }),
  );

  const addMember = useMutation(
    orpc.spaceMembers.add.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success("Zugriff gewährt");
      },
      onError: toastError,
    }),
  );

  const updateRole = useMutation(
    orpc.spaceMembers.updateRole.mutationOptions({ onSuccess: refresh, onError: toastError }),
  );

  const removeMember = useMutation(
    orpc.spaceMembers.remove.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success("Mitglied entfernt");
      },
      onError: toastError,
    }),
  );

  const trimmedName = name.trim();
  const generalDirty = trimmedName !== space.name || (color ?? null) !== (space.color ?? null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Space-Einstellungen</SheetTitle>
          <SheetDescription>
            Allgemeines, Sichtbarkeit und Mitglieder von „{space.name}".
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Allgemein</h3>
            <label className="block text-xs text-muted-foreground" htmlFor="space-name">
              Name
            </label>
            <Input
              id="space-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name des Spaces"
            />
            <div className="text-xs text-muted-foreground">Farbe</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {SPACE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Farbe ${c}`}
                  className={cn(
                    "size-6 rounded-full border border-black/10 transition-transform hover:scale-110",
                    (color ?? DEFAULT_SPACE_COLOR) === c &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!trimmedName || !generalDirty || updateGeneral.isPending}
                onClick={() => updateGeneral.mutate({ id: space.id, name: trimmedName, color })}
              >
                {updateGeneral.isPending ? "Speichern …" : "Speichern"}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">Sichtbarkeit</h3>
              <p className="text-xs text-muted-foreground">
                Wer den Space grundsätzlich sehen darf.
              </p>
            </div>
            <div role="radiogroup" aria-label="Sichtbarkeit" className="grid gap-2">
              {VISIBILITIES.map((v) => {
                const Icon = VISIBILITY_ICON[v];
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={updateVisibility.isPending}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-input hover:bg-muted/50",
                    )}
                    onClick={() => {
                      if (active) return;
                      setVisibility(v);
                      updateVisibility.mutate({ id: space.id, visibility: v });
                    }}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{VISIBILITY_LABEL[v] ?? v}</div>
                      <p className="text-xs text-muted-foreground">{VISIBILITY_HINT[v]}</p>
                    </div>
                    {active ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">Mitglieder & Gruppen</h3>
              <p className="text-xs text-muted-foreground">
                Explizite Zugriffe zusätzlich zur Sichtbarkeit.
              </p>
            </div>
            <MemberAccessManager
              members={members}
              isLoading={membersQuery.isPending}
              addableUsers={addableUsers}
              addableGroups={addableGroups}
              defaultRole="editor"
              onAdd={({ subject, value, role }) =>
                addMember.mutateAsync(
                  subject === "user"
                    ? { spaceId: space.id, subject: "user", userId: value, role: role as "editor" }
                    : {
                        spaceId: space.id,
                        subject: "role",
                        roleName: value,
                        role: role as "editor",
                      },
                )
              }
              addPending={addMember.isPending}
              onUpdateRole={(id, role) => updateRole.mutate({ id, role: role as "editor" })}
              updatePending={updateRole.isPending}
              onRemove={(id) => removeMember.mutateAsync({ id })}
              removePending={removeMember.isPending}
              noUsersHint="Alle Organisationsmitglieder sind bereits im Space."
              noGroupsHint="Keine weiteren Gruppen verfügbar. Lege welche unter Einstellungen › Gruppen an."
              removeTitle="Mitglied entfernen?"
              removeDescription={(label) => `„${label}" verliert den Zugriff auf diesen Space.`}
            />
          </section>

          <section className="space-y-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">Datenexport</h3>
              <p className="text-xs text-muted-foreground">
                Lädt Seiten, Hierarchie, Tags, Metadaten und Attachments als portables ZIP-Archiv.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["markdown", "html", "json"] as const).map((format) => (
                <Button
                  key={format}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.location.assign(spaceExportUrl(env.VITE_SERVER_URL, space.id, format));
                  }}
                >
                  <Download className="size-3.5" />
                  {format === "markdown" ? "Markdown" : format.toUpperCase()}
                </Button>
              ))}
            </div>
          </section>

          {/* Gefahrenzone: der Sheet wird vom Aufrufer nur für Space-Admins
              gerendert (myRole === "admin"), dieselbe Schranke gilt hier. */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-destructive">Gefahrenzone</h3>
            <div className="divide-y divide-border rounded-lg border border-destructive/30">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Space archivieren</div>
                  <p className="text-xs text-muted-foreground">
                    Der Space wird ausgeblendet, Seiten bleiben erhalten.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={archiveSpace.isPending}
                  onClick={() => setConfirmArchive(true)}
                >
                  Archivieren
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Space löschen</div>
                  <p className="text-xs text-muted-foreground">
                    Löscht den Space und alle Inhalte dauerhaft.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteSpace.isPending}
                  onClick={() => setConfirmDelete(true)}
                >
                  Löschen
                </Button>
              </div>
            </div>
          </section>
        </div>

        <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Space archivieren?</AlertDialogTitle>
              <AlertDialogDescription>
                „{space.name}" wird ausgeblendet und erscheint nicht mehr in der Übersicht. Die
                Seiten bleiben erhalten.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiveSpace.isPending}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                disabled={archiveSpace.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  archiveSpace.mutate({ id: space.id });
                }}
              >
                {archiveSpace.isPending ? "Archivieren …" : "Archivieren"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Space löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                „{space.name}" wird dauerhaft gelöscht. Alle Seiten in diesem Space werden
                unwiderruflich gelöscht.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteSpace.isPending}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteSpace.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  deleteSpace.mutate({ id: space.id });
                }}
              >
                {deleteSpace.isPending ? "Löschen …" : "Löschen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
