import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { toastError } from "@/lib/query";
import { membersQueryOptions, teamMembersQueryOptions, useOrgRefresh } from "@/lib/org-queries";
import { Avatar, AvatarFallback } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";

export type TeamTarget = { id: string; name: string };

/**
 * Membership editor for one team: every organization member with a toggle.
 *
 * Teams carry no permissions of their own (see docs/permissions.md) — they exist
 * so a whole group of people can be granted space or page access in one row, via
 * `spaceMember.teamId` / `pageMember.teamId`.
 */
export function TeamMembersSheet({
  open,
  onOpenChange,
  organizationId,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  team: TeamTarget | null;
}) {
  const refresh = useOrgRefresh();
  const membersQuery = useQuery(membersQueryOptions(organizationId));
  const teamMembersQuery = useQuery(teamMembersQueryOptions(team?.id ?? null));

  const members = membersQuery.data?.members ?? [];
  const memberUserIds = new Set((teamMembersQuery.data ?? []).map((entry) => entry.userId));

  const toggle = useMutation({
    mutationFn: async ({ userId, next }: { userId: string; next: boolean }) => {
      if (!team) throw new Error("Kein Team ausgewählt");
      const result = next
        ? await authClient.organization.addTeamMember({
            teamId: team.id,
            userId,
            organizationId,
          })
        : await authClient.organization.removeTeamMember({
            teamId: team.id,
            userId,
            organizationId,
          });
      if (result.error) throw new Error(result.error.message ?? "Änderung fehlgeschlagen");
      return result.data;
    },
    onSuccess: async (_data, variables) => {
      await refresh();
      toast.success(variables.next ? "Zum Team hinzugefügt" : "Aus dem Team entfernt");
    },
    onError: toastError,
  });

  const pending = membersQuery.isPending || teamMembersQuery.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Mitglieder von „{team?.name ?? ""}"</SheetTitle>
          <SheetDescription>
            Teams bündeln Personen. Zugriff auf Inhalte bekommt ein Team erst, wenn du es in einem
            Space oder auf einer Seite als Mitglied hinzufügst.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {pending ? (
            <div className="space-y-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Mitglieder in der Organisation.</p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map((member) => {
                const checked = memberUserIds.has(member.user.id);
                return (
                  <li key={member.id} className="flex items-center gap-3 py-2.5">
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[11px]">
                        {initials(member.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{member.user.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.user.email}
                      </div>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={toggle.isPending}
                      onCheckedChange={(next) =>
                        toggle.mutate({ userId: member.user.id, next: Boolean(next) })
                      }
                      aria-label={`${member.user.name} im Team`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-4">
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Fertig
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
