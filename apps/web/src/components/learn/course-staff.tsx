import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";

import { QueryError } from "@/components/query-error";
import { initials } from "@/lib/format";
import { COURSE_ROLE_DESCRIPTION, COURSE_ROLE_LABEL } from "@/lib/learn-labels";
import { membersQueryOptions, rolesQueryOptions, teamsQueryOptions } from "@/lib/org-queries";
import { friendlyErrorMessage } from "@/utils/orpc";
import { orpc } from "@/utils/orpc";
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
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Button } from "@nilovon-wiki/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * The course team: who may author, grade and administer this course.
 *
 * Shaped after `components/access/member-access-manager.tsx` — the same
 * collapsed add form, the same per-row role select and removal confirm — but not
 * that component: a course grant has four roles of its own and a third subject
 * (a team), where the wiki's access manager knows only users and groups with the
 * wiki's own four roles.
 */

const COURSE_ROLES = ["reviewer", "assistant", "instructor", "owner"] as const;

const SUBJECTS = [
  { value: "user", label: "Person" },
  { value: "team", label: "Team" },
  { value: "role", label: "Gruppe" },
] as const;

type Subject = (typeof SUBJECTS)[number]["value"];

/**
 * The server refuses to drop or demote the last `owner` — a course without one
 * can no longer be administered from the inside. `friendlyErrorMessage` maps
 * that BAD_REQUEST to generic "check your input" copy, which explains nothing,
 * so the reason is named here instead.
 */
const LAST_OWNER = "Ein Kurs braucht mindestens eine Kursleitung.";

function courseErrorMessage(error: Error): string {
  return /at least one owner/i.test(error.message) ? LAST_OWNER : friendlyErrorMessage(error);
}

export function CourseStaff({
  courseId,
  organizationId,
  canManage,
}: {
  courseId: string;
  organizationId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState<Subject>("user");
  const [value, setValue] = useState("");
  const [role, setRole] = useState<(typeof COURSE_ROLES)[number]>("instructor");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; label: string } | null>(null);

  const staff = useQuery(orpc.learn.courseMembers.list.queryOptions({ input: { courseId } }));

  // Candidates come from Better Auth, the owner of members, teams and groups —
  // the same three sources the organization settings pick from.
  const members = useQuery({ ...membersQueryOptions(organizationId), enabled: canManage });
  const teams = useQuery({ ...teamsQueryOptions(organizationId), enabled: canManage });
  const groups = useQuery({ ...rolesQueryOptions(organizationId), enabled: canManage });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.learn.courseMembers.list.key() });

  const add = useMutation(
    orpc.learn.courseMembers.add.mutationOptions({
      onSuccess: () => {
        void invalidate();
        setValue("");
        setAdding(false);
        toast.success("Zum Kursteam hinzugefügt");
      },
      onError: (error) => toast.error(courseErrorMessage(error)),
    }),
  );

  const update = useMutation(
    orpc.learn.courseMembers.update.mutationOptions({
      onSuccess: () => {
        void invalidate();
        toast.success("Rolle geändert");
      },
      onError: (error) => toast.error(courseErrorMessage(error)),
    }),
  );

  const remove = useMutation(
    orpc.learn.courseMembers.remove.mutationOptions({
      onSuccess: () => {
        void invalidate();
        setRemoveTarget(null);
        toast.success("Aus dem Kursteam entfernt");
      },
      onError: (error) => toast.error(courseErrorMessage(error)),
    }),
  );

  const rows = staff.data ?? [];
  // Mirrored client-side so the last owner's controls are disabled rather than
  // offering an action the server is going to refuse.
  const ownerCount = rows.filter((row) => row.role === "owner").length;

  const takenUserIds = new Set(rows.flatMap((row) => (row.user ? [row.user.id] : [])));
  const takenTeamIds = new Set(rows.flatMap((row) => (row.team ? [row.team.id] : [])));
  const takenGroups = new Set(rows.flatMap((row) => (row.roleName ? [row.roleName] : [])));

  const userOptions = (members.data?.members ?? []).filter(
    (member) => !takenUserIds.has(member.user.id),
  );
  const teamOptions = (teams.data ?? []).filter((team) => !takenTeamIds.has(team.id));
  const groupOptions = (groups.data ?? []).filter((group) => !takenGroups.has(group.role));

  const hasOptions =
    subject === "user"
      ? userOptions.length > 0
      : subject === "team"
        ? teamOptions.length > 0
        : groupOptions.length > 0;

  const submitAdd = () => {
    if (!value) return;
    add.mutate({
      courseId,
      subject,
      role,
      ...(subject === "user" ? { userId: value } : {}),
      ...(subject === "team" ? { teamId: value } : {}),
      ...(subject === "role" ? { roleName: value } : {}),
    });
  };

  if (staff.isError) {
    return <QueryError error={staff.error} onRetry={() => void staff.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {staff.isPending
            ? "Wird geladen …"
            : rows.length === 1
              ? "1 Eintrag im Kursteam"
              : `${rows.length} Einträge im Kursteam`}
        </p>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant={adding ? "ghost" : "outline"}
            onClick={() => {
              setAdding((previous) => !previous);
              setValue("");
            }}
          >
            {adding ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {adding ? "Abbrechen" : "Zum Kursteam hinzufügen"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Das Kursteam ändern kann nur die Kursleitung.
          </p>
        )}
      </div>

      {adding ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          {/* Segmented switch: which kind of subject the picker below lists. The
              API mirrors the wiki's `space_member` model, so a grant goes to a
              person, a team or an organization group. */}
          <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border ring-inset">
            {SUBJECTS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={subject === entry.value}
                className={cn(
                  "rounded-[min(var(--radius-md),10px)] px-3 py-1 text-xs font-medium transition-colors",
                  subject === entry.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setSubject(entry.value);
                  setValue("");
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {hasOptions ? (
            <>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="staff-subject"
                >
                  {SUBJECTS.find((entry) => entry.value === subject)?.label}
                </label>
                <NativeSelect
                  id="staff-subject"
                  className="w-full"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  <NativeSelectOption value="">Auswählen …</NativeSelectOption>
                  {subject === "user"
                    ? userOptions.map((member) => (
                        <NativeSelectOption key={member.user.id} value={member.user.id}>
                          {member.user.name}
                        </NativeSelectOption>
                      ))
                    : subject === "team"
                      ? teamOptions.map((team) => (
                          <NativeSelectOption key={team.id} value={team.id}>
                            {team.name}
                          </NativeSelectOption>
                        ))
                      : groupOptions.map((group) => (
                          <NativeSelectOption key={group.id} value={group.role}>
                            {group.role}
                          </NativeSelectOption>
                        ))}
                </NativeSelect>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="staff-role">
                    Rolle
                  </label>
                  <NativeSelect
                    id="staff-role"
                    className="w-full"
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as (typeof COURSE_ROLES)[number])
                    }
                  >
                    {COURSE_ROLES.map((entry) => (
                      <NativeSelectOption key={entry} value={entry}>
                        {COURSE_ROLE_LABEL[entry]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <Button size="sm" disabled={!value || add.isPending} onClick={submitAdd}>
                  {add.isPending ? "Hinzufügen …" : "Hinzufügen"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{COURSE_ROLE_DESCRIPTION[role]}</p>
            </>
          ) : (
            // A dead picker next to "nothing to add" reads as broken, so only
            // the reason is shown.
            <p className="text-xs text-muted-foreground">
              {subject === "user"
                ? "Alle Mitglieder der Organisation gehören schon zum Kursteam."
                : subject === "team"
                  ? "Es gibt kein Team, das noch nicht im Kursteam ist."
                  : "Es gibt keine Gruppe, die noch nicht im Kursteam ist."}
            </p>
          )}
        </div>
      ) : null}

      {staff.isPending ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-2.5 p-2.5">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Für diesen Kurs ist noch niemand als Kursteam eingetragen.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((row) => {
            const label = row.user?.name ?? row.team?.name ?? row.roleName ?? "—";
            const sub =
              row.user?.email ??
              (row.subject === "team" ? "Team" : row.subject === "role" ? "Gruppe" : "Person");
            const isLastOwner = row.role === "owner" && ownerCount === 1;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2.5 p-2.5">
                {row.user ? (
                  <Avatar className="size-7 shrink-0">
                    <AvatarImage src={row.user.image ?? undefined} alt="" />
                    <AvatarFallback className="text-[11px]">{initials(label)}</AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Users className="size-3.5" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">{sub}</p>
                </div>

                {canManage ? (
                  <NativeSelect
                    size="sm"
                    aria-label={`Rolle von ${label}`}
                    value={row.role}
                    disabled={update.isPending || isLastOwner}
                    onChange={(event) =>
                      update.mutate({
                        id: row.id,
                        role: event.target.value as (typeof COURSE_ROLES)[number],
                      })
                    }
                  >
                    {COURSE_ROLES.map((entry) => (
                      <NativeSelectOption key={entry} value={entry}>
                        {COURSE_ROLE_LABEL[entry]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {COURSE_ROLE_LABEL[row.role]}
                  </span>
                )}

                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`${label} aus dem Kursteam entfernen`}
                    disabled={remove.isPending || isLastOwner}
                    onClick={() => setRemoveTarget({ id: row.id, label })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                ) : null}

                {isLastOwner ? (
                  <p className="w-full text-xs text-muted-foreground">{LAST_OWNER}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aus dem Kursteam entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.label} verliert die Rechte an diesem Kurs. Eine bestehende Einschreibung bleibt davon unberührt.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removeTarget) remove.mutate({ id: removeTarget.id });
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
