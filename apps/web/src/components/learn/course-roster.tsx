import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { initials, timeAgo } from "@/lib/format";
import { ENROLLMENT_STATUS_LABEL } from "@/lib/learn-labels";
import { membersQueryOptions } from "@/lib/org-queries";
import { toastError } from "@/lib/query";
import { QueryError } from "@/components/query-error";
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
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nilovon-wiki/ui/components/table";

/**
 * The enrolled learners, as the course team works with them.
 *
 * Two capabilities meet in one table, which is why they are separate props: the
 * server lets `grade` *read* the roster — it names individuals, so viewing the
 * course is not enough — while approving, inviting and removing are all
 * `manage`. An assistant therefore sees the list and none of the buttons, and
 * this component says so rather than offering actions the API would refuse.
 */

const PAGE_SIZE = 50;

const STATUS_FILTERS = ["all", "pending", "active", "completed", "dropped"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type RosterStatus = "pending" | "active" | "completed" | "dropped";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "default",
  active: "secondary",
  completed: "outline",
  dropped: "destructive",
};

export function CourseRoster({
  courseId,
  organizationId,
  canManage,
}: {
  courseId: string;
  organizationId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  const rosterInput = {
    courseId,
    status: status === "all" ? undefined : (status as RosterStatus),
    limit: PAGE_SIZE,
    offset,
  };
  const roster = useQuery(orpc.learn.enrollments.roster.queryOptions({ input: rosterInput }));

  // Every write below changes some page of the roster, not only the one on
  // screen, so invalidation goes at the procedure key rather than this input.
  const invalidateRoster = () =>
    queryClient.invalidateQueries({ queryKey: orpc.learn.enrollments.roster.key() });

  const decide = useMutation(
    orpc.learn.enrollments.decide.mutationOptions({
      onSuccess: (enrollment) => {
        void invalidateRoster();
        toast.success(enrollment.status === "active" ? "Anfrage freigegeben" : "Anfrage abgelehnt");
      },
      onError: toastError,
    }),
  );

  const remove = useMutation(
    orpc.learn.enrollments.remove.mutationOptions({
      onSuccess: () => {
        void invalidateRoster();
        setRemoveTarget(null);
        toast.success("Teilnahme beendet");
      },
      onError: toastError,
    }),
  );

  const rows = roster.data ?? [];
  const enrolledUserIds = useMemo(() => new Set(rows.map((row) => row.userId)), [rows]);

  const setFilter = (next: StatusFilter) => {
    setStatus(next);
    // Narrowing invalidates the current page — staying on page three of a
    // one-page result would look like an empty course.
    setOffset(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="roster-status-filter"
          >
            Status
          </label>
          <NativeSelect
            id="roster-status-filter"
            value={status}
            onChange={(event) => setFilter(event.target.value as StatusFilter)}
          >
            <NativeSelectOption value="all">Alle</NativeSelectOption>
            {STATUS_FILTERS.filter((value) => value !== "all").map((value) => (
              <NativeSelectOption key={value} value={value}>
                {ENROLLMENT_STATUS_LABEL[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        {canManage ? (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            Teilnehmende hinzufügen
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Teilnehmende hinzufügen oder entfernen kann nur die Kursleitung.
          </p>
        )}
      </div>

      {roster.isError ? (
        <QueryError error={roster.error} onRetry={() => void roster.refetch()} />
      ) : roster.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Keine Teilnehmenden</EmptyTitle>
            <EmptyDescription>
              {status === "all"
                ? "In diesem Kurs ist noch niemand eingeschrieben."
                : `Niemand hat gerade den Status „${ENROLLMENT_STATUS_LABEL[status]}".`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">Person</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Fortschritt</TableHead>
                <TableHead scope="col">Lektionen</TableHead>
                <TableHead scope="col">Zuletzt aktiv</TableHead>
                <TableHead scope="col" className="text-right">
                  Aktionen
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const name = row.user?.name ?? "Gelöschtes Konto";
                const pending = row.status === "pending";
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-7 shrink-0">
                          <AvatarImage src={row.user?.image ?? undefined} alt="" />
                          <AvatarFallback className="text-[11px]">{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{name}</p>
                          {row.user?.email ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {row.user.email}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>
                        {ENROLLMENT_STATUS_LABEL[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-32">
                      <Progress value={row.progressPercent} />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {row.progressPercent} %
                      </span>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {row.completedLessons} / {row.totalLessons}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.lastActivityAt ? timeAgo(row.lastActivityAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        {canManage && pending ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ id: row.id, approve: true })}
                            >
                              <Check className="size-4" aria-hidden />
                              Freigeben
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ id: row.id, approve: false })}
                            >
                              <X className="size-4" aria-hidden />
                              Ablehnen
                            </Button>
                          </>
                        ) : null}
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`${name} aus dem Kurs entfernen`}
                            onClick={() => setRemoveTarget({ id: row.id, name })}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* The roster answers with a plain array, so there is no total to page
          against — a full page is the only evidence that another one exists. */}
      {offset > 0 || rows.length === PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {offset + 1}–{offset + rows.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Zurück
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Weiter
            </Button>
          </div>
        </div>
      ) : null}

      <InviteLearnersDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        courseId={courseId}
        organizationId={organizationId}
        enrolledUserIds={enrolledUserIds}
        onInvited={() => void invalidateRoster()}
      />

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Teilnahme beenden?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.name} verliert den Zugang zu diesem Kurs. Der Lernfortschritt geht dabei verloren.`
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

/**
 * Picks people out of the organization and enrols them directly.
 *
 * `enrollments.invite` takes bare `userIds`, so the candidates come from the
 * organization's member list — the same source the settings screens pick from.
 * Anyone already on the roster is filtered out rather than shown greyed: the
 * server would silently skip them, and a checkbox that does nothing is worse
 * than an absent row.
 */
function InviteLearnersDialog({
  open,
  onOpenChange,
  courseId,
  organizationId,
  enrolledUserIds,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  organizationId: string;
  enrolledUserIds: Set<string>;
  onInvited: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const members = useQuery({ ...membersQueryOptions(organizationId), enabled: open });

  const invite = useMutation(
    orpc.learn.enrollments.invite.mutationOptions({
      onSuccess: (rows) => {
        onInvited();
        setSelected([]);
        setQuery("");
        onOpenChange(false);
        toast.success(
          rows.length === 1 ? "1 Person eingeschrieben" : `${rows.length} Personen eingeschrieben`,
        );
      },
      onError: toastError,
    }),
  );

  const needle = query.trim().toLowerCase();
  const candidates = (members.data?.members ?? [])
    .filter((member) => !enrolledUserIds.has(member.user.id))
    .filter(
      (member) =>
        !needle ||
        member.user.name.toLowerCase().includes(needle) ||
        member.user.email.toLowerCase().includes(needle),
    );

  const toggle = (userId: string, checked: boolean) =>
    setSelected((previous) =>
      checked ? [...previous, userId] : previous.filter((id) => id !== userId),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Teilnehmende hinzufügen</DialogTitle>
          <DialogDescription>
            Ausgewählte Personen werden sofort eingeschrieben — ohne eigene Anfrage und ohne
            Freigabeschritt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-8"
              placeholder="Nach Name oder E-Mail suchen …"
              aria-label="Personen suchen"
            />
          </div>

          {members.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {needle
                ? `Kein Treffer für „${query}".`
                : "Alle Mitglieder der Organisation sind bereits eingeschrieben."}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border border-border">
              {candidates.map((member) => {
                const checked = selected.includes(member.user.id);
                return (
                  <li key={member.user.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 p-2.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => toggle(member.user.id, next === true)}
                      />
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className="text-[11px]">
                          {initials(member.user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{member.user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={selected.length === 0 || invite.isPending}
            onClick={() => invite.mutate({ courseId, userIds: selected })}
          >
            {invite.isPending
              ? "Einschreiben …"
              : selected.length > 0
                ? `${selected.length} einschreiben`
                : "Einschreiben"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
