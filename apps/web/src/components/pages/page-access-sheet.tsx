import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { MemberAccessManager } from "@/components/access/member-access-manager";
import { VISIBILITY_LABEL } from "@/lib/labels";
import { membersQueryOptions, rolesQueryOptions } from "@/lib/org-queries";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";

const OVERRIDES = ["public", "private", "restricted"] as const;
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
  const invalidatePages = useInvalidate(orpc.pages.key());

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
              <MemberAccessManager
                members={members}
                isLoading={accessQuery.isPending}
                addableUsers={addableUsers}
                addableGroups={addableGroups}
                defaultRole="viewer"
                onAdd={({ subject, value, role }) =>
                  addMember.mutateAsync(
                    subject === "user"
                      ? { pageId, subject: "user", userId: value, role: role as "viewer" }
                      : { pageId, subject: "role", roleName: value, role: role as "viewer" },
                  )
                }
                addPending={addMember.isPending}
                onUpdateRole={(id, role) => updateRole.mutate({ id, role: role as "viewer" })}
                updatePending={updateRole.isPending}
                onRemove={(id) => removeMember.mutateAsync({ id })}
                removePending={removeMember.isPending}
                emptyState={
                  <p className="text-sm text-muted-foreground">
                    Noch keine expliziten Mitglieder. Bei „Privat" hat sonst nur ein Space-Admin
                    Zugriff.
                  </p>
                }
                noUsersHint="Alle Organisationsmitglieder haben bereits einen Eintrag."
                noGroupsHint="Keine weiteren Gruppen verfügbar."
                removeDescription={(label) =>
                  `${label} verliert den expliziten Zugriff auf diese Seite.`
                }
              />
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
