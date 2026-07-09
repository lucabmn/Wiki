import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { ROLE_LABEL, ROLE_VARIANT } from "@/lib/labels";
import { toastError } from "@/lib/query";
import {
  invitationsQueryOptions,
  membersQueryOptions,
  rolesQueryOptions,
  useOrgRefresh,
} from "@/lib/org-queries";
import { InviteMemberDialog } from "@/components/settings/invite-member-dialog";
import {
  MemberRolesDialog,
  type MemberRolesTarget,
} from "@/components/settings/member-roles-dialog";
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
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nilovon-wiki/ui/components/table";

export const Route = createFileRoute("/_auth/settings/members")({
  component: MembersSettings,
});

/** Split a member's comma-separated role string into individual role names. */
function splitRoles(role: string | null | undefined): string[] {
  return (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function RoleBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <Badge variant="outline">—</Badge>;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {roles.map((role) => (
        <Badge key={role} variant={ROLE_VARIANT[role] ?? "outline"}>
          {ROLE_LABEL[role] ?? role}
        </Badge>
      ))}
    </div>
  );
}

function MembersSettings() {
  const { auth } = Route.useRouteContext();
  const organizationId = auth.organization.id;
  const refresh = useOrgRefresh();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<MemberRolesTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ memberId: string; name: string } | null>(null);

  const membersQuery = useQuery(membersQueryOptions(organizationId));
  const invitationsQuery = useQuery(invitationsQueryOptions(organizationId));
  const rolesQuery = useQuery(rolesQueryOptions(organizationId));

  const members = membersQuery.data?.members ?? [];
  const groups = rolesQuery.data ?? [];
  const pendingInvitations = (invitationsQuery.data ?? []).filter(
    (invitation) => invitation.status === "pending",
  );

  const ownerCount = members.filter((member) => splitRoles(member.role).includes("owner")).length;

  const remove = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId,
      });
      if (result.error) throw new Error(result.error.message ?? "Entfernen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Mitglied entfernt");
      setRemoveTarget(null);
    },
    onError: toastError,
  });

  const cancelInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({ invitationId });
      if (result.error) throw new Error(result.error.message ?? "Zurückziehen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Einladung zurückgezogen");
    },
    onError: toastError,
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Mitglieder</h2>
            <p className="text-sm text-muted-foreground">
              {members.length} {members.length === 1 ? "Mitglied" : "Mitglieder"} in{" "}
              {auth.organization.name}.
            </p>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Mitglied einladen
          </Button>
        </div>

        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead className="text-right">Rollen & Gruppen</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {membersQuery.isPending ? (
                [0, 1, 2].map((row) => (
                  <TableRow key={row}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-7 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Keine Mitglieder.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => {
                  const roles = splitRoles(member.role);
                  const isOwner = roles.includes("owner");
                  const isLastOwner = isOwner && ownerCount === 1;
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-7">
                            <AvatarFallback className="text-[11px]">
                              {initials(member.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{member.user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
                      <TableCell>
                        <RoleBadges roles={roles} />
                      </TableCell>
                      <TableCell>
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
                            <DropdownMenuItem
                              onClick={() =>
                                setRoleTarget({
                                  memberId: member.id,
                                  name: member.user.name,
                                  roles,
                                })
                              }
                            >
                              Rollen & Gruppen verwalten
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={isLastOwner}
                              onClick={() =>
                                setRemoveTarget({ memberId: member.id, name: member.user.name })
                              }
                            >
                              Aus Organisation entfernen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </section>

      {pendingInvitations.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Offene Einladungen</h2>
            <p className="text-sm text-muted-foreground">{pendingInvitations.length} ausstehend.</p>
          </div>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>E-Mail</TableHead>
                  <TableHead>Rolle</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>
                      <RoleBadges roles={splitRoles(invitation.role)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancelInvite.isPending}
                        onClick={() => cancelInvite.mutate(invitation.id)}
                      >
                        Zurückziehen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      ) : null}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        organizationId={organizationId}
        groups={groups}
      />

      <MemberRolesDialog
        open={roleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRoleTarget(null);
        }}
        organizationId={organizationId}
        groups={groups}
        member={roleTarget}
        isLastOwner={roleTarget !== null && roleTarget.roles.includes("owner") && ownerCount === 1}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mitglied entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.name} verliert den Zugriff auf diese Organisation. Diese Aktion kann nicht rückgängig gemacht werden.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => {
                if (removeTarget) remove.mutate(removeTarget.memberId);
              }}
            >
              {remove.isPending ? "Entfernen …" : "Entfernen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
