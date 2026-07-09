import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { initials } from "@/lib/format";
import { VISIBILITY_LABEL, WIKI_ROLE_LABEL } from "@/lib/labels";
import { membersQueryOptions, rolesQueryOptions } from "@/lib/org-queries";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const VISIBILITIES = ["public", "private", "restricted"] as const;
const WIKI_ROLES = ["viewer", "commenter", "editor", "admin"] as const;

const VISIBILITY_HINT: Record<string, string> = {
  public: "Jedes Organisationsmitglied kann lesen. Schreiben braucht eine Rolle.",
  private: "Nur explizite Mitglieder haben Zugriff.",
  restricted: "Ersteller und explizite Mitglieder haben Zugriff.",
};

export function SpaceSettingsSheet({
  open,
  onOpenChange,
  space,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: { id: string; name: string; visibility: string };
  organizationId: string;
}) {
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

  const refresh = () => {
    invalidateMembers();
    invalidateMyRole();
  };

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
        toast.success("Mitglied entfernt");
      },
      onError: toastError,
    }),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Space-Einstellungen</SheetTitle>
          <SheetDescription>Sichtbarkeit und Mitglieder von „{space.name}".</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
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
                        onClick={() => removeMember.mutate({ id: member.id })}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
