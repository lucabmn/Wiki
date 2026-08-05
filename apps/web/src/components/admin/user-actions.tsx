import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";

import { BanDialog, ConfirmDialog } from "./user-dialogs";

type TargetUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  banned: boolean;
};

/**
 * The acting half of the console.
 *
 * Two rules shape it: every irreversible action asks first, and each dialog
 * names the person rather than "this user" — the list and the detail page look
 * alike, and banning the wrong account is not undoable in any useful sense.
 * Nothing here reads wiki content; that requires impersonation, which is
 * audited on both ends.
 */
export function UserActions({
  user,
  currentUserId,
  impersonationEnabled,
}: {
  user: TargetUser;
  currentUserId: string;
  impersonationEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const isSelf = user.id === currentUserId;
  const isAdmin = user.roles.includes("admin");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  };

  const setRole = useMutation(
    orpc.admin.users.setRole.mutationOptions({
      onSuccess: (_data, variables) => {
        toast.success(
          variables.role === "admin"
            ? `${user.name} ist jetzt Instanz-Administrator`
            : `${user.name} ist kein Instanz-Administrator mehr`,
        );
        refresh();
      },
      onError: toastError,
    }),
  );

  const unban = useMutation(
    orpc.admin.users.unban.mutationOptions({
      onSuccess: () => {
        toast.success(`${user.name} ist wieder freigeschaltet`);
        refresh();
      },
      onError: toastError,
    }),
  );

  const sendReset = useMutation(
    orpc.admin.users.sendPasswordReset.mutationOptions({
      onSuccess: () => toast.success(`Passwort-Link an ${user.email} gesendet`),
      onError: toastError,
    }),
  );

  const impersonate = useMutation({
    mutationFn: async () => {
      const result = await authClient.admin.impersonateUser({ userId: user.id });
      if (result.error) throw new Error(result.error.message ?? "Übernahme fehlgeschlagen");
      return result.data;
    },
    // Hard navigation: the session cookie just changed identity, and every
    // cached query still belongs to the admin.
    onSuccess: () => window.location.assign("/"),
    onError: toastError,
  });

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        label={isAdmin ? "Admin-Rechte entziehen" : "Zum Admin machen"}
        icon={ShieldCheck}
        title={isAdmin ? "Administrator-Rechte entziehen?" : "Zum Instanz-Administrator ernennen?"}
        description={
          isAdmin
            ? `${user.name} verliert den Zugang zur Instanz-Verwaltung. Organisations-Rollen bleiben unberührt.`
            : `${user.name} kann anschließend jedes Konto dieser Installation verwalten, sperren und übernehmen — in jeder Organisation, unabhängig von Organisations-Rollen.`
        }
        confirmLabel={isAdmin ? "Rechte entziehen" : "Ernennen"}
        destructive={isAdmin}
        disabled={isSelf}
        disabledReason="Die eigene Rolle lässt sich hier nicht ändern."
        onConfirm={() => setRole.mutate({ userId: user.id, role: isAdmin ? "user" : "admin" })}
        isPending={setRole.isPending}
      />

      {user.banned ? (
        <Button
          variant="outline"
          size="sm"
          disabled={unban.isPending}
          onClick={() => unban.mutate({ userId: user.id })}
        >
          <ShieldCheck className="size-4" aria-hidden />
          Sperre aufheben
        </Button>
      ) : (
        <BanDialog userId={user.id} userName={user.name} disabled={isSelf} onDone={refresh} />
      )}

      <ConfirmDialog
        label="Passwort-Reset"
        icon={KeyRound}
        title="Passwort zurücksetzen lassen?"
        description={`${user.email} erhält den gewohnten Link zum Zurücksetzen. Du erfährst das neue Passwort nicht — der Zugang bleibt an das Postfach gebunden.`}
        confirmLabel="Link senden"
        onConfirm={() => sendReset.mutate({ userId: user.id })}
        isPending={sendReset.isPending}
      />

      {impersonationEnabled ? (
        <ConfirmDialog
          label="Konto übernehmen"
          icon={UserRoundCog}
          title={`Als ${user.name} arbeiten?`}
          description="Du siehst und änderst danach genau das, was diese Person sieht. Start und Ende werden protokolliert — auch im Aktivitätsfeed der Person selbst — und die Sitzung endet von allein."
          confirmLabel="Konto übernehmen"
          disabled={isSelf || isAdmin}
          disabledReason={
            isSelf
              ? "Das ist dein eigenes Konto."
              : "Andere Instanz-Administratoren lassen sich nicht übernehmen."
          }
          onConfirm={() => impersonate.mutate()}
          isPending={impersonate.isPending}
        />
      ) : null}

      <DeleteUserButton user={user} isSelf={isSelf} />
    </div>
  );
}

/**
 * Deletion is typed out, not clicked away: it removes the account, its sessions
 * and its sign-in methods, and nothing else in this console is as final.
 */
function DeleteUserButton({ user, isSelf }: { user: TargetUser; isSelf: boolean }) {
  const [confirmation, setConfirmation] = useState("");

  const remove = useMutation(
    orpc.admin.users.remove.mutationOptions({
      // Leaves the detail page of an account that no longer exists, rather than
      // invalidating into a NOT_FOUND.
      onSuccess: () => window.location.assign("/admin/users"),
      onError: toastError,
    }),
  );

  return (
    <ConfirmDialog
      label="Löschen"
      icon={Trash2}
      title="Konto endgültig löschen?"
      description={`Alle Anmeldungen und Zugangsdaten von ${user.name} werden entfernt. Beiträge in Wikis bleiben bestehen, verlieren aber ihre Zuordnung. Das lässt sich nicht rückgängig machen.`}
      confirmLabel="Endgültig löschen"
      destructive
      disabled={isSelf}
      disabledReason="Das eigene Konto lässt sich hier nicht löschen."
      confirmDisabled={confirmation !== user.email}
      onClose={() => setConfirmation("")}
      onConfirm={() => remove.mutate({ userId: user.id })}
      isPending={remove.isPending}
    >
      <Field>
        <FieldLabel htmlFor="delete-confirmation">
          Tippe zur Bestätigung die E-Mail-Adresse
        </FieldLabel>
        <Input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={user.email}
          autoComplete="off"
        />
        <FieldDescription>{user.email}</FieldDescription>
      </Field>
    </ConfirmDialog>
  );
}
