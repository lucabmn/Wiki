import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { useOrgRefresh, type OrgRole } from "@/lib/org-queries";
import { ROLE_LABEL } from "@/lib/labels";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";

const STATIC_INVITE_ROLES = ["member", "admin", "owner"] as const;

const emailSchema = z.string().email("Bitte eine gültige E-Mail-Adresse eingeben");

/**
 * Invites a person to the active organization with an initial role. Fine-grained
 * group assignment happens later via the member's "Rollen & Gruppen"-Dialog; the
 * invite only needs one starting role.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
  organizationId,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  groups: OrgRole[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [error, setError] = useState<string | null>(null);
  const refresh = useOrgRefresh();

  const invite = useMutation({
    mutationFn: async (input: { email: string; role: string }) => {
      const result = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role as "member",
        organizationId,
      });
      if (result.error) throw new Error(result.error.message ?? "Einladung fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Einladung verschickt");
      reset();
      onOpenChange(false);
    },
    onError: toastError,
  });

  const reset = () => {
    setEmail("");
    setRole("member");
    setError(null);
  };

  const submit = () => {
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültige E-Mail");
      return;
    }
    setError(null);
    invite.mutate({ email: parsed.data, role });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mitglied einladen</DialogTitle>
          <DialogDescription>
            Die Person erhält eine Einladung per E-Mail und tritt mit der gewählten Rolle bei.
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
            <FieldLabel htmlFor="invite-email">E-Mail-Adresse</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              placeholder="name@firma.de"
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="invite-role">Rolle</FieldLabel>
            <NativeSelect
              id="invite-role"
              className="w-full"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <optgroup label="Rollen">
                {STATIC_INVITE_ROLES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {ROLE_LABEL[value] ?? value}
                  </NativeSelectOption>
                ))}
              </optgroup>
              {groups.length > 0 ? (
                <optgroup label="Gruppen">
                  {groups.map((group) => (
                    <NativeSelectOption key={group.id} value={group.role}>
                      {group.role}
                    </NativeSelectOption>
                  ))}
                </optgroup>
              ) : null}
            </NativeSelect>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={invite.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={invite.isPending || !email.trim()}>
              {invite.isPending ? "Einladen …" : "Einladen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
