import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { initials } from "@/lib/format";
import { WIKI_ROLE_LABEL } from "@/lib/labels";
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
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const WIKI_ROLES = ["viewer", "commenter", "editor", "admin"] as const;

/** A member/grant row as returned by `spaceMembers.list` / `pageAccess.get`. */
export type AccessMember = {
  id: string;
  subject: string;
  role: string;
  roleName: string | null;
  user: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
};

/**
 * Shared user/group access-management block: an add form (person or group +
 * wiki role), the current member list with per-row role change and removal, and
 * the removal confirm dialog. Extracted from the space-settings and page-access
 * sheets, which drive it with their own routers via the async `onAdd`/`onRemove`
 * handlers (resolve = success, so the component clears its local state) and
 * surface-specific copy.
 */
export function MemberAccessManager({
  members,
  isLoading,
  addableUsers,
  addableGroups,
  defaultRole = "viewer",
  onAdd,
  addPending,
  onUpdateRole,
  updatePending,
  onRemove,
  removePending,
  emptyState,
  noUsersHint,
  noGroupsHint,
  removeTitle = "Zugriff entfernen?",
  removeDescription,
}: {
  members: AccessMember[];
  isLoading: boolean;
  addableUsers: { user: { id: string; name: string } }[];
  addableGroups: { id: string; role: string }[];
  defaultRole?: string;
  onAdd: (input: { subject: "user" | "role"; value: string; role: string }) => Promise<unknown>;
  addPending: boolean;
  onUpdateRole: (id: string, role: string) => void;
  updatePending: boolean;
  onRemove: (id: string) => Promise<unknown>;
  removePending: boolean;
  // Rendered when there are no members (surfaces differ: a page override needs a
  // hint, a space always keeps its creator admin so passes nothing).
  emptyState?: ReactNode;
  noUsersHint: string;
  noGroupsHint: string;
  removeTitle?: string;
  removeDescription: (label: string) => string;
}) {
  const [subject, setSubject] = useState<"user" | "role">("user");
  const [value, setValue] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);

  const submitAdd = async () => {
    try {
      await onAdd({ subject, value, role });
      setValue(""); // clear only on success; onError already toasts
    } catch {
      /* handled by the mutation's onError */
    }
  };

  const submitRemove = async () => {
    if (!removeTarget) return;
    try {
      await onRemove(removeTarget.id);
      setRemoveTarget(null);
    } catch {
      /* handled by the mutation's onError */
    }
  };

  return (
    <>
      <div className="space-y-2 rounded-lg border border-dashed border-border p-2.5">
        <div className="flex gap-1">
          {(["user", "role"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={subject === s ? "default" : "outline"}
              onClick={() => {
                setSubject(s);
                setValue("");
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
              value={value}
              onChange={(event) => setValue(event.target.value)}
            >
              {subject === "user" ? (
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
          <NativeSelect value={role} onChange={(event) => setRole(event.target.value)}>
            {WIKI_ROLES.map((r) => (
              <NativeSelectOption key={r} value={r}>
                {WIKI_ROLE_LABEL[r]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button size="sm" disabled={!value || addPending} onClick={submitAdd}>
            Hinzufügen
          </Button>
        </div>
        {subject === "user" && addableUsers.length === 0 ? (
          <p className="text-xs text-muted-foreground">{noUsersHint}</p>
        ) : null}
        {subject === "role" && addableGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">{noGroupsHint}</p>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : members.length === 0 ? (
        (emptyState ?? null)
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
                  disabled={updatePending}
                  onChange={(event) => onUpdateRole(member.id, event.target.value)}
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
                  disabled={removePending}
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

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget ? removeDescription(removeTarget.label) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={removePending}
              onClick={(event) => {
                event.preventDefault();
                void submitRemove();
              }}
            >
              {removePending ? "Entfernen …" : "Entfernen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
