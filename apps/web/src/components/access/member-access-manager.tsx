import { useState, type ReactNode } from "react";
import { Plus, Search, Trash2, Users, X } from "lucide-react";

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
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";

const WIKI_ROLES = ["viewer", "commenter", "editor", "admin"] as const;

/** Above this many grants the list gets a filter instead of only scrolling. */
const SEARCH_THRESHOLD = 7;

/** A member/grant row as returned by `spaceMembers.list` / `pageAccess.get`. */
export type AccessMember = {
  id: string;
  subject: string;
  role: string;
  roleName: string | null;
  user: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
};

const memberLabel = (member: AccessMember) =>
  member.user?.name ?? member.team?.name ?? member.roleName ?? "—";

/**
 * Shared user/group access-management block: the current member list with
 * per-row role change and removal, an add form that stays collapsed until
 * requested, and the removal confirm dialog. Extracted from the space-settings
 * and page-access sheets, which drive it with their own routers via the async
 * `onAdd`/`onRemove` handlers (resolve = success, so the component clears its
 * local state) and surface-specific copy.
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
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState<"user" | "role">("user");
  const [value, setValue] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [query, setQuery] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);

  const options = subject === "user" ? addableUsers.map((m) => m.user) : null;
  const hasOptions = subject === "user" ? addableUsers.length > 0 : addableGroups.length > 0;

  // A stale query with no visible input to clear it would strand the user, so
  // the filter only applies while its input is on screen.
  const showFilter = !isLoading && members.length > SEARCH_THRESHOLD;
  const needle = showFilter ? query.trim().toLowerCase() : "";
  const matches = needle
    ? members.filter((m) =>
        [m.user?.name, m.user?.email, m.team?.name, m.roleName, WIKI_ROLE_LABEL[m.role]].some(
          (field) => field?.toLowerCase().includes(needle),
        ),
      )
    : members;
  const byLabel = (a: AccessMember, b: AccessMember) =>
    memberLabel(a).localeCompare(memberLabel(b), "de");
  // Grants come back in insertion order; grouped and alphabetical scans far
  // better once there are more than a handful.
  const groupRows = matches.filter((m) => m.user === null).sort(byLabel);
  const userRows = matches.filter((m) => m.user !== null).sort(byLabel);
  const sections = [
    { key: "groups", title: "Gruppen", rows: groupRows },
    { key: "users", title: "Personen", rows: userRows },
  ];
  // Derived from the full list, not the matches — otherwise the headers would
  // pop in and out while typing in the filter.
  const showSectionTitles =
    members.some((m) => m.user === null) && members.some((m) => m.user !== null);

  const submitAdd = async () => {
    try {
      await onAdd({ subject, value, role });
      setValue(""); // clear only on success; onError already toasts
      setAdding(false);
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

  const renderRow = (member: AccessMember) => {
    const label = memberLabel(member);
    const isGroup = member.user === null;
    const sub = member.user?.email ?? (member.subject === "role" ? "Gruppe" : "Team");
    return (
      <li key={member.id} className="flex items-center gap-2.5 p-2.5">
        {isGroup ? (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-3.5" />
          </div>
        ) : (
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-[11px]">{initials(label)}</AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        </div>
        <NativeSelect
          size="sm"
          aria-label={`Rolle von ${label}`}
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
          className="text-muted-foreground hover:text-destructive"
          disabled={removePending}
          onClick={() => setRemoveTarget({ id: member.id, label })}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Entfernen</span>
        </Button>
      </li>
    );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {/* The count would only repeat what the empty state already says. */}
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? "Wird geladen …"
            : members.length === 0
              ? null
              : needle
                ? `${matches.length} von ${members.length} Einträgen`
                : members.length === 1
                  ? "1 Eintrag"
                  : `${members.length} Einträge`}
        </p>
        <Button
          type="button"
          size="sm"
          variant={adding ? "ghost" : "outline"}
          onClick={() => {
            // Opening on the empty side would look like a dead end, so start on
            // whichever side still has candidates.
            if (!adding && addableUsers.length === 0 && addableGroups.length > 0)
              setSubject("role");
            setAdding((prev) => !prev);
            setValue("");
          }}
        >
          {adding ? <X className="size-4" /> : <Plus className="size-4" />}
          {adding ? "Abbrechen" : "Zugriff geben"}
        </Button>
      </div>

      {adding ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          {/* Segmented switch: which kind of subject the picker below lists. */}
          <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border ring-inset">
            {(["user", "role"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={subject === s}
                className={cn(
                  "rounded-[min(var(--radius-md),10px)] px-3 py-1 text-xs font-medium transition-colors",
                  subject === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setSubject(s);
                  setValue("");
                }}
              >
                {s === "user" ? "Person" : "Gruppe"}
              </button>
            ))}
          </div>

          {hasOptions ? (
            <>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="access-subject"
                >
                  {subject === "user" ? "Person" : "Gruppe"}
                </label>
                <NativeSelect
                  id="access-subject"
                  className="w-full"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {options ? (
                    <>
                      <NativeSelectOption value="">Person wählen …</NativeSelectOption>
                      {options.map((user) => (
                        <NativeSelectOption key={user.id} value={user.id}>
                          {user.name}
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

              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="access-role"
                  >
                    Rolle
                  </label>
                  <NativeSelect
                    id="access-role"
                    className="w-full"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    {WIKI_ROLES.map((r) => (
                      <NativeSelectOption key={r} value={r}>
                        {WIKI_ROLE_LABEL[r]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <Button size="sm" disabled={!value || addPending} onClick={submitAdd}>
                  {addPending ? "Hinzufügen …" : "Hinzufügen"}
                </Button>
              </div>
            </>
          ) : (
            // No candidates left: a dead picker next to "nothing to add" reads as
            // broken, so show only the reason.
            <p className="text-xs text-muted-foreground">
              {subject === "user" ? noUsersHint : noGroupsHint}
            </p>
          )}
        </div>
      ) : null}

      {/* A space can hold dozens of explicit grants — filtering beats scrolling
          once the list outgrows a glance. */}
      {showFilter ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            placeholder="Nach Name, E-Mail oder Rolle filtern …"
            aria-label="Mitglieder und Gruppen filtern"
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2.5 p-2.5">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        (emptyState ?? null)
      ) : matches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Kein Treffer für „{query}".
        </p>
      ) : (
        // Short lists ride the sheet's own scroll — a second scrollbar in the
        // same column only helps once the list is long enough to bury the
        // sections below it (and that is exactly when the filter appears).
        <div
          className={cn(
            "rounded-lg border border-border",
            showFilter ? "max-h-80 overflow-y-auto overscroll-contain" : "overflow-hidden",
          )}
        >
          {sections.map(({ key, title, rows }) =>
            rows.length === 0 ? null : (
              <div key={key}>
                {showSectionTitles ? (
                  <div
                    className={cn(
                      "z-10 border-b border-border bg-muted/70 px-2.5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur-sm",
                      // Only meaningful while this list is its own scroll box.
                      showFilter && "sticky top-0",
                    )}
                  >
                    {title} · {rows.length}
                  </div>
                ) : null}
                <ul className="divide-y divide-border">{rows.map(renderRow)}</ul>
              </div>
            ),
          )}
        </div>
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
