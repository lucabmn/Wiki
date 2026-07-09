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

const OVERRIDES = ["public", "private", "restricted"] as const;
const WIKI_ROLES = ["viewer", "commenter", "editor", "admin"] as const;
const INHERIT = "inherit";

export function PageAccessSheet({
  open,
  onOpenChange,
  pageId,
  pageTitle,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  pageTitle: string;
  organizationId: string;
}) {
  const invalidateAccess = useInvalidate(orpc.pageAccess.get.key());
  const invalidateMyRole = useInvalidate(orpc.pageAccess.myRole.key());
  const invalidatePages = useInvalidate(orpc.pages.list.key());

  const accessQuery = useQuery(
    orpc.pageAccess.get.queryOptions({ input: { pageId }, enabled: open }),
  );
  const orgMembersQuery = useQuery({ ...membersQueryOptions(organizationId), enabled: open });
  const groupsQuery = useQuery({ ...rolesQueryOptions(organizationId), enabled: open });

  const access = accessQuery.data;
  const members = access?.members ?? [];
  const orgMembers = orgMembersQuery.data?.members ?? [];
  const groups = groupsQuery.data ?? [];
  const memberUserIds = new Set(members.map((m) => m.user?.id).filter(Boolean));
  const grantedRoleNames = new Set(members.map((m) => m.roleName).filter(Boolean));
  const addableUsers = orgMembers.filter((m) => !memberUserIds.has(m.user.id));
  const addableGroups = groups.filter((g) => !grantedRoleNames.has(g.role));
  const overrideActive = (access?.visibility ?? null) !== null;

  const [addSubject, setAddSubject] = useState<"user" | "role">("user");
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<string>("viewer");

  const refresh = () => {
    invalidateAccess();
    invalidateMyRole();
    invalidatePages();
  };

  const setVisibility = useMutation(
    orpc.pageAccess.setVisibility.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success("Zugriff aktualisiert");
      },
      onError: toastError,
    }),
  );
  const addMember = useMutation(
    orpc.pageAccess.addMember.mutationOptions({
      onSuccess: () => {
        refresh();
        setAddUserId("");
        toast.success("Zugriff gewährt");
      },
      onError: toastError,
    }),
  );
  const updateRole = useMutation(
    orpc.pageAccess.updateRole.mutationOptions({ onSuccess: refresh, onError: toastError }),
  );
  const removeMember = useMutation(
    orpc.pageAccess.removeMember.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success("Zugriff entzogen");
      },
      onError: toastError,
    }),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Seitenzugriff</SheetTitle>
          <SheetDescription>Wer darf „{pageTitle}" sehen und bearbeiten.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Sichtbarkeit</h3>
            <NativeSelect
              className="w-full"
              value={access?.visibility ?? INHERIT}
              disabled={setVisibility.isPending || accessQuery.isPending}
              onChange={(event) =>
                setVisibility.mutate({
                  pageId,
                  visibility:
                    event.target.value === INHERIT
                      ? null
                      : (event.target.value as "public" | "private" | "restricted"),
                })
              }
            >
              <NativeSelectOption value={INHERIT}>Vom Space übernehmen</NativeSelectOption>
              {OVERRIDES.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {VISIBILITY_LABEL[v] ?? v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {overrideActive
                ? "Diese Seite hat einen eigenen Zugriff, unabhängig vom Space (kann nur einschränken, nicht erweitern)."
                : "Diese Seite folgt dem Zugriff ihres Spaces."}
            </p>
          </section>

          {overrideActive ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Seitenmitglieder</h3>

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
                  <NativeSelect
                    value={addRole}
                    onChange={(event) => setAddRole(event.target.value)}
                  >
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
                              pageId,
                              subject: "user",
                              userId: addUserId,
                              role: addRole as "viewer",
                            }
                          : {
                              pageId,
                              subject: "role",
                              roleName: addUserId,
                              role: addRole as "viewer",
                            },
                      )
                    }
                  >
                    Hinzufügen
                  </Button>
                </div>
                {addSubject === "user" && addableUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Alle Organisationsmitglieder haben bereits einen Eintrag.
                  </p>
                ) : null}
                {addSubject === "role" && addableGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Keine weiteren Gruppen verfügbar.</p>
                ) : null}
              </div>

              {accessQuery.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Noch keine expliziten Mitglieder. Bei „Privat" hat sonst nur ein Space-Admin
                  Zugriff.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {members.map((member) => {
                    const label = member.user?.name ?? member.team?.name ?? member.roleName ?? "—";
                    const sub =
                      member.user?.email ?? (member.subject === "role" ? "Gruppe" : "Team");
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
                            updateRole.mutate({
                              id: member.id,
                              role: event.target.value as "viewer",
                            })
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
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
