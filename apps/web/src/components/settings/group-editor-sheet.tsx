import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { RESERVED_ROLE_NAMES, useOrgRefresh, type OrgRole } from "@/lib/org-queries";
import { countGrantedActions } from "@/lib/permission-catalog";
import { PermissionMatrix } from "./permission-matrix";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";

/** Validate a group name; returns an error message or null. `others` is the set
 *  of existing group names (lowercased) excluding the one being edited. */
function validateName(raw: string, others: Set<string>): string | null {
  const name = raw.trim();
  if (name.length < 2) return "Mindestens 2 Zeichen";
  if (name.length > 60) return "Höchstens 60 Zeichen";
  // Roles are stored comma-separated on the member row, so a comma would corrupt
  // the list.
  if (name.includes(",")) return "Kommas sind nicht erlaubt";
  const normalized = name.toLowerCase();
  if ((RESERVED_ROLE_NAMES as readonly string[]).includes(normalized))
    return "Dieser Name ist für eine Standardrolle reserviert";
  if (others.has(normalized)) return "Eine Gruppe mit diesem Namen existiert bereits";
  return null;
}

/**
 * Create or edit a group (dynamic role). The permission matrix is the core: it
 * grants content permissions freely and org-management permissions behind a
 * warning. Group names are lowercased server-side.
 */
export function GroupEditorSheet({
  open,
  onOpenChange,
  organizationId,
  existing,
  allGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  existing: OrgRole | null;
  allGroups: OrgRole[];
}) {
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<PermissionRequest>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const refresh = useOrgRefresh();

  // Seed the form each time the sheet opens (create → blank, edit → the group).
  useEffect(() => {
    if (!open) return;
    setName(existing?.role ?? "");
    setPermission(existing?.permission ?? {});
    setNameError(null);
  }, [open, existing]);

  const otherNames = new Set(
    allGroups.filter((group) => group.id !== existing?.id).map((group) => group.role.toLowerCase()),
  );

  const save = useMutation({
    mutationFn: async (input: { name: string; permission: PermissionRequest }) => {
      if (existing) {
        const result = await authClient.organization.updateRole({
          roleName: existing.role,
          organizationId,
          data: { roleName: input.name, permission: input.permission },
        });
        if (result.error) throw new Error(result.error.message ?? "Speichern fehlgeschlagen");
        return result.data;
      }
      const result = await authClient.organization.createRole({
        role: input.name,
        permission: input.permission,
        organizationId,
      });
      if (result.error) throw new Error(result.error.message ?? "Erstellen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success(existing ? "Gruppe aktualisiert" : "Gruppe erstellt");
      onOpenChange(false);
    },
    onError: toastError,
  });

  const grantCount = countGrantedActions(permission);

  const submit = () => {
    const error = validateName(name, otherNames);
    if (error) {
      setNameError(error);
      return;
    }
    if (grantCount === 0) {
      toast.error("Wähle mindestens ein Recht aus");
      return;
    }
    save.mutate({ name: name.trim(), permission });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{existing ? "Gruppe bearbeiten" : "Gruppe erstellen"}</SheetTitle>
          <SheetDescription>
            Eine Gruppe bündelt Rechte und lässt sich Mitgliedern zuweisen.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor="group-name">Name</FieldLabel>
            <Input
              id="group-name"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="z. B. Redaktion"
              aria-invalid={nameError ? true : undefined}
            />
            {nameError ? (
              <FieldError>{nameError}</FieldError>
            ) : (
              <FieldDescription>
                Der Name wird intern kleingeschrieben gespeichert.
              </FieldDescription>
            )}
          </Field>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Rechte</h3>
              <span className="text-xs text-muted-foreground">
                {grantCount} {grantCount === 1 ? "Recht" : "Rechte"} gewählt
              </span>
            </div>
            <PermissionMatrix value={permission} onChange={setPermission} />
          </div>
        </div>

        <SheetFooter className="border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Abbrechen
          </Button>
          <Button type="button" onClick={submit} disabled={save.isPending || !name.trim()}>
            {save.isPending ? "Speichern …" : existing ? "Speichern" : "Gruppe erstellen"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
