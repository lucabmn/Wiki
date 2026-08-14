import { CreatePageDialog } from "@/components/create-page-dialog";
import DashboardLayout from "@/components/layouts/dashboard-layout";
import { LearningSummary } from "@/components/learn/learning-summary";
import { QueryError } from "@/components/query-error";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { ACTION_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  FilePlus2,
  FileText,
  Folder,
  History,
  MessageSquare,
  Paperclip,
  Plus,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

/** One activity row as the feed queries it (the fields this page reads). */
type FeedRow = {
  id: string;
  action: string;
  pageId: string | null;
  metadata: unknown;
  createdAt: Date;
  actor: { name: string } | null;
  space: { name: string; color: string | null } | null;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The human-readable subject an activity row is about. Every writer stores a
 * denormalized label in `metadata` (page/space title, uploaded file name) so
 * the feed stays readable even after the referenced row is gone; rows without
 * one fall back to the bare action label.
 */
function subjectOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const fields = metadata as { title?: unknown; name?: unknown; fileName?: unknown };
  for (const value of [fields.title, fields.name, fields.fileName]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function actionIcon(action: string): LucideIcon {
  if (action.startsWith("comment.")) return MessageSquare;
  if (action.startsWith("attachment.")) return Paperclip;
  if (action.startsWith("space.")) return Folder;
  if (action === "page.created") return FilePlus2;
  return FileText;
}

/** "Heute" / "Gestern" / "12. Juli" — the day header a feed row is filed under. */
function dayLabel(date: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

// Consecutive runs, not a keyed bucket: the feed arrives newest-first, so rows
// of one day are always adjacent.
function groupByDay(rows: FeedRow[]): { label: string; rows: FeedRow[] }[] {
  const groups: { label: string; rows: FeedRow[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.createdAt);
    const current = groups.at(-1);
    if (current?.label === label) current.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

/** The space a row belongs to, as a colored dot plus its name. */
function SpaceMark({ space }: { space: { name: string; color: string | null } | null }) {
  if (!space) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: space.color ?? DEFAULT_SPACE_COLOR }}
      />
      <span className="truncate">{space.name}</span>
    </span>
  );
}

function Header() {
  const { auth } = Route.useRouteContext();
  const [newPageOpen, setNewPageOpen] = useState(false);

  const { data: overview } = useQuery(orpc.dashboard.overview.queryOptions({ input: {} }));
  const { data: spaces } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));

  // One factual line instead of a stat wall: how much there is to read, how
  // much is waiting for an answer.
  const summary = overview
    ? [
        plural(overview.pageCount, "Seite", "Seiten"),
        spaces ? plural(spaces.length, "Space", "Spaces") : null,
        plural(overview.openComments, "offener Kommentar", "offene Kommentare"),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{auth.organization.name}</h1>
        {summary ? (
          <p className="text-sm text-muted-foreground">{summary}</p>
        ) : (
          <Skeleton className="mt-1.5 h-3.5 w-56" />
        )}
      </div>
      <Button onClick={() => setNewPageOpen(true)}>
        <Plus className="size-4" />
        Neue Seite
      </Button>
      <CreatePageDialog open={newPageOpen} onOpenChange={setNewPageOpen} />
    </header>
  );
}

/**
 * The pages the caller touched most recently, newest first and one card per
 * page — the "pick up where you left off" row. Derived from their own activity
 * feed, so it needs no extra endpoint.
 */
function ContinueWorking() {
  const { auth } = Route.useRouteContext();
  const { data, isPending } = useQuery(
    orpc.activity.list.queryOptions({ input: { actorId: auth.session.user.id, limit: 30 } }),
  );

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedRow[] = [];
    for (const row of (data ?? []) as FeedRow[]) {
      if (!row.pageId || !row.action.startsWith("page.") || seen.has(row.pageId)) continue;
      if (!subjectOf(row.metadata)) continue;
      seen.add(row.pageId);
      out.push(row);
      if (out.length === 3) break;
    }
    return out;
  }, [data]);

  if (isPending) {
    return (
      <section>
        <SectionHeader title="Weiter bearbeiten" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </section>
    );
  }

  // Nothing edited yet: stay out of the way rather than show an empty shelf.
  if (recent.length === 0) return null;

  return (
    <section>
      <SectionHeader title="Weiter bearbeiten" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((row) => (
          <Link
            key={row.id}
            to="/pages/$id"
            params={{ id: row.pageId as string }}
            className="block"
          >
            <Card
              size="sm"
              className="h-full gap-1.5 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <SpaceMark space={row.space} />
              <p className="line-clamp-2 font-medium">{subjectOf(row.metadata)}</p>
              <p className="text-xs text-muted-foreground">
                {ACTION_LABEL[row.action] ?? row.action} · {timeAgo(row.createdAt)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ActivityRow({ row }: { row: FeedRow }) {
  const Icon = actionIcon(row.action);
  const subject = subjectOf(row.metadata);
  const label = ACTION_LABEL[row.action] ?? row.action;
  const meta = [row.actor?.name, subject ? label : null, timeAgo(row.createdAt)]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{subject ?? label}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <div className="hidden max-w-[40%] shrink-0 sm:block">
        <SpaceMark space={row.space} />
      </div>
    </div>
  );

  // A row keeps its page id only while the page exists — deletions null it out,
  // so those entries stay in the history but aren't links.
  return row.pageId ? (
    <Link
      to="/pages/$id"
      params={{ id: row.pageId }}
      className="block transition-colors hover:bg-muted/50"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function ActivityFeed() {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.activity.list.queryOptions({ input: { limit: 12 } }),
  );

  const groups = useMemo(() => groupByDay((data ?? []) as FeedRow[]), [data]);

  return (
    <section>
      <SectionHeader
        title="Aktivität"
        action={
          <Link
            to="/spaces"
            className="text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
          >
            Alle Spaces
          </Link>
        }
      />
      {isPending ? (
        <Card className="gap-0 p-0">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
            >
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </Card>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : groups.length === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Noch nichts passiert</EmptyTitle>
            <EmptyDescription>
              Sobald jemand eine Seite anlegt, bearbeitet oder kommentiert, steht es hier.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 p-0">
          {groups.map((group) => (
            <div key={group.label} className="border-b border-border last:border-0">
              <div className="border-b border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                {group.label}
              </div>
              <div className="divide-y divide-border/60">
                {group.rows.map((row) => (
                  <ActivityRow key={row.id} row={row} />
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function Favorites() {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.me.listFavorites.queryOptions({ input: {} }),
  );

  return (
    <section>
      <SectionHeader title="Favoriten" />
      {isPending ? (
        <Card className="gap-0 p-0">
          {["w-3/5", "w-4/5", "w-2/5"].map((width) => (
            <div key={width} className="flex items-center gap-2.5 px-4 py-2.5">
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className={cn("h-3.5", width)} />
            </div>
          ))}
        </Card>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Star className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Keine Favoriten</EmptyTitle>
            <EmptyDescription>
              Markiere eine Seite mit dem Stern, um sie hier griffbereit zu haben.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="gap-0 p-0">
          <div className="divide-y divide-border/60">
            {data.map((page) => (
              <Link
                key={page.id}
                to="/pages/$id"
                params={{ id: page.id }}
                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-muted/50"
              >
                {page.icon ? (
                  <span className="w-4 shrink-0 text-center leading-none">{page.icon}</span>
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

// The _auth layout guard guarantees an active organization here, so the
// queries below can run unconditionally.
function RouteComponent() {
  return (
    <DashboardLayout className="gap-6 p-7">
      <Header />
      <ContinueWorking />
      {/* Learning sits above the activity feed rather than beside it: a course
          with a deadline is something to act on, and the feed is something to
          read. Somebody who takes no courses gets the counters and one line
          pointing at the catalog. */}
      <LearningSummary />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityFeed />
        </div>
        <Favorites />
      </div>
    </DashboardLayout>
  );
}
