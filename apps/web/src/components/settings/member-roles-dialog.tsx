import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { useOrgRefresh, type OrgRole } from "@/lib/org-queries";
import { ROLE_LABEL } from "@/lib/labels";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";

export type MemberRolesTarget = {
  memberId: string;
  name: string;
  roles: string[];
};

const STATIC_ROLES: { value: string; description: string }[] = [
  { value: "owner", description: "Voller Zugriff, inklusive Löschen der Organisation." },
  { value: "admin", description: "Inhalte und Mitglieder verwalten." },
  { value: "member", description: "Seiten lesen und bearbeiten." },
];

/**
 * Assigns any combination of static roles and groups to one member. A member's
 * role is a comma-separated list server-side; we submit the selection as an
 * array. The last owner cannot lose the owner role (would orphan the org).
 */
export function MemberRolesDialog({
  open,
  onOpenChange,
  organizationId,
  groups,
  member,
  isLastOwner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  groups: OrgRole[];
  member: MemberRolesTarget | null;
  isLastOwner: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const refresh = useOrgRefresh();

  // Re-seed the selection whenever a different member's dialog opens.
  useEffect(() => {
    if (member) setSelected(new Set(member.roles));
  }, [member]);

  const save = useMutation({
    mutationFn: async (roles: string[]) => {
      if (!member) throw new Error("Kein Mitglied ausgewählt");
      const result = await authClient.organization.updateMemberRole({
        memberId: member.memberId,
        role: roles,
        organizationId,
      });
      if (result.error) throw new Error(result.error.message ?? "Aktualisierung fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Rollen aktualisiert");
      onOpenChange(false);
    },
    onError: toastError,
  });

  const toggle = (role: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(role);
      else next.delete(role);
      return next;
    });
  };

  // Guard: the sole owner may not drop the owner role.
  const ownerLocked = isLastOwner && selected.has("owner");
  const isEmpty = selected.size === 0;

  const Row = ({
    value,
    label,
    description,
    disabled,
  }: {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }) => (
    <label
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/40 has-data-checked:border-primary/40 has-data-checked:bg-primary/5"
      htmlFor={`role-${value}`}
    >
      <Checkbox
        id={`role-${value}`}
        className="mt-0.5"
        checked={selected.has(value)}
        disabled={disabled}
        onCheckedChange={(checked) => toggle(value, checked === true)}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rollen & Gruppen</DialogTitle>
          <DialogDescription>
            {member ? `Zugriff von ${member.name} festlegen.` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Rollen
            </h3>
            <div className="space-y-2">
              {STATIC_ROLES.map((role) => (
                <Row
                  key={role.value}
                  value={role.value}
                  label={ROLE_LABEL[role.value] ?? role.value}
                  description={role.description}
                  disabled={role.value === "owner" && ownerLocked}
                />
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Gruppen
            </h3>
            {groups.length > 0 ? (
              <div className="space-y-2">
                {groups.map((group) => (
                  <Row key={group.id} value={group.role} label={group.role} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Noch keine Gruppen. Lege im Tab „Gruppen" welche an.
              </p>
            )}
          </section>

          {ownerLocked ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Dies ist der einzige Inhaber. Die Inhaber-Rolle kann nicht entfernt werden, bevor ein
              weiterer Inhaber ernannt wurde.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            disabled={save.isPending || isEmpty}
            onClick={() => save.mutate(Array.from(selected))}
          >
            {save.isPending ? "Speichern …" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
