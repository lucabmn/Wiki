import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { initials } from "@/lib/format";
import { VISIBILITY_LABEL, WIKI_ROLE_LABEL } from "@/lib/labels";
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
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";

const VISIBILITIES = ["public", "private", "restricted"] as const;
const WIKI_ROLES = ["viewer", "commenter", "editor", "admin"] as const;

const VISIBILITY_HINT: Record<string, string> = {
  public: "Jedes Organisationsmitglied kann lesen. Schreiben braucht eine Rolle.",
  private: "Nur explizite Mitglieder haben Zugriff.",
  restricted: "Ersteller und explizite Mitglieder haben Zugriff.",
};

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

  const [addSubject, setAddSubject] = useState<"user" | "role">("user");
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<string>("editor");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Draft for the "Allgemein" section; re-seeded from the space each time the
  // sheet opens (and after a save, when the fresh space props arrive).
  const [name, setName] = useState(space.name);
  const [color, setColor] = useState<string | null>(space.color);
  useEffect(() => {
    if (open) {
      setName(space.name);
      setColor(space.color);
    }
  }, [open, space.name, space.color]);

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
      onError: toastError,
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
        setAddUserId("");
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
        setRemoveTarget(null);
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

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Sichtbarkeit</h3>
            <NativeSelect
              className="w-full"
              value={space.visibility}
              disabled={updateVisibility.isPending}
              onChange={(event) =>
                updateVisibility.mutate({
                  id: space.id,
                  visibility: event.target.value as "public",
                })
              }
            >
              {VISIBILITIES.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {VISIBILITY_LABEL[v] ?? v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{VISIBILITY_HINT[space.visibility]}</p>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Mitglieder & Gruppen</h3>

            <div className="space-y-2 rounded-lg border border-dashed border-border p-2.5">
              <div className="flex gap-1">
                {(["user", "role"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={addSubject === s ? "default" : "outline"}
                    onClick={() => {
                      setAddSubject(s);
                      setAddUserId("");
                    }}
                  >
                    {s === "user" ? "Person" : "Gruppe"}
                  </Button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <NativeSelect
                    className="w-full"
                    value={addUserId}
                    onChange={(event) => setAddUserId(event.target.value)}
                  >
                    {addSubject === "user" ? (
                      <>
                        <NativeSelectOption value="">Person wählen …</NativeSelectOption>
                        {addableUsers.map((m) => (
                          <NativeSelectOption key={m.user.id} value={m.user.id}>
                            {m.user.name}
                          </NativeSelectOption>
                        ))}
                      </>
                    ) : (
                      <>
                        <NativeSelectOption value="">Gruppe wählen …</NativeSelectOption>
                        {addableGroups.map((g) => (
                          <NativeSelectOption key={g.id} value={g.role}>
                            {g.role}
                          </NativeSelectOption>
                        ))}
                      </>
                    )}
                  </NativeSelect>
                </div>
                <NativeSelect value={addRole} onChange={(event) => setAddRole(event.target.value)}>
                  {WIKI_ROLES.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {WIKI_ROLE_LABEL[r]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  size="sm"
                  disabled={!addUserId || addMember.isPending}
                  onClick={() =>
                    addMember.mutate(
                      addSubject === "user"
                        ? {
                            spaceId: space.id,
                            subject: "user",
                            userId: addUserId,
                            role: addRole as "editor",
                          }
                        : {
                            spaceId: space.id,
                            subject: "role",
                            roleName: addUserId,
                            role: addRole as "editor",
                          },
                    )
                  }
                >
                  Hinzufügen
                </Button>
              </div>
              {addSubject === "user" && addableUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Alle Organisationsmitglieder sind bereits im Space.
                </p>
              ) : null}
              {addSubject === "role" && addableGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Keine weiteren Gruppen verfügbar. Lege welche unter Einstellungen › Gruppen an.
                </p>
              ) : null}
            </div>

            {membersQuery.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ul className="space-y-1.5">
                {members.map((member) => {
                  const label = member.user?.name ?? member.team?.name ?? member.roleName ?? "—";
                  const sub = member.user?.email ?? (member.subject === "role" ? "Gruppe" : "Team");
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-2.5 rounded-lg border border-border p-2"
                    >
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[11px]">{initials(label)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{label}</div>
                        <div className="truncate text-xs text-muted-foreground">{sub}</div>
                      </div>
                      <NativeSelect
                        size="sm"
                        value={member.role}
                        disabled={updateRole.isPending}
                        onChange={(event) =>
                          updateRole.mutate({ id: member.id, role: event.target.value as "editor" })
                        }
                      >
                        {WIKI_ROLES.map((r) => (
                          <NativeSelectOption key={r} value={r}>
                            {WIKI_ROLE_LABEL[r]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Entfernen"
                        disabled={removeMember.isPending}
                        onClick={() => setRemoveTarget({ id: member.id, label })}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Entfernen</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
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

        <AlertDialog
          open={removeTarget !== null}
          onOpenChange={(o) => {
            if (!o) setRemoveTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mitglied entfernen?</AlertDialogTitle>
              <AlertDialogDescription>
                {removeTarget
                  ? `„${removeTarget.label}" verliert den Zugriff auf diesen Space.`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeMember.isPending}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                disabled={removeMember.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (removeTarget) removeMember.mutate({ id: removeTarget.id });
                }}
              >
                {removeMember.isPending ? "Entfernen …" : "Entfernen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
