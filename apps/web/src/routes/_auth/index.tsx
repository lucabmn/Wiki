import { CreatePageDialog } from "@/components/create-page-dialog";
import DashboardLayout from "@/components/layouts/dashboard-layout";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { ACTION_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

const relativeTime = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
function timeAgo(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(seconds) >= secs) {
      return relativeTime.format(Math.round(seconds / secs), unit);
    }
  }
  return relativeTime.format(0, "minute");
}

function RecentActivity() {
  const navigate = useNavigate();
  const { data, isPending } = useQuery(orpc.activity.list.queryOptions({ input: { limit: 5 } }));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Zuletzt bearbeitet</h2>
        <Link
          to="/spaces"
          className="text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
        >
          Alle Spaces
        </Link>
      </div>
      {isPending ? (
        <Card className="gap-0 py-0">
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
        </Card>
      ) : !data?.length ? (
        <Card className="px-4 py-6">
          <p className="text-sm text-muted-foreground">
            Noch keine Aktivität. Sobald dein Team Seiten anlegt oder bearbeitet, erscheint sie
            hier.
          </p>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {data.map((r) => (
            <button
              type="button"
              key={r.id}
              disabled={!r.pageId}
              onClick={() => r.pageId && navigate({ to: "/pages/$id", params: { id: r.pageId } })}
              className="group flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                style={{ backgroundColor: r.space?.color ?? DEFAULT_SPACE_COLOR }}
              >
                <FileText className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium group-hover:text-primary">
                  {ACTION_LABEL[r.action]}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.actor?.name} - {timeAgo(r.createdAt)}
                </div>
              </div>
              <Badge variant="outline" className="shrink-0">
                {r.space?.name}
              </Badge>
            </button>
          ))}
        </Card>
      )}
    </section>
  );
}

function Favorites() {
  const { data, isPending } = useQuery(orpc.me.listFavorites.queryOptions({ input: {} }));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Favoriten</h2>
      </div>
      <Card>
        <CardContent className="space-y-1.5">
          {isPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-3/4" />)
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground">Noch keine Favoriten.</p>
          ) : (
            data.map((page) => (
              <Link key={page.id} to="/pages/$id" params={{ id: page.id }}>
                <div className="flex items-center gap-2 text-sm">
                  {page.icon ? (
                    <span className="leading-none">{page.icon}</span>
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{page.title}</span>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function HeroCard() {
  const { auth } = Route.useRouteContext();
  const { data: overview, isPending } = useQuery(
    orpc.dashboard.overview.queryOptions({ input: {} }),
  );
  const [newPageOpen, setNewPageOpen] = useState(false);

  const now = new Date();

  const greeting =
    now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 ? "Guten Tag" : "Guten Abend";

  // "–" while the counts load; the members total comes from the already-loaded
  // org context, so it renders immediately.
  const n = (value: number | undefined) => (value === undefined ? "–" : value.toString());
  const memberCount = auth.organization.members.length;

  const stats: [string, string, string][] = [
    ["Seiten", n(overview?.pageCount), `+${n(overview?.pagesCreatedThisWeek)} diese Woche`],
    [
      "Mitglieder",
      memberCount.toString(),
      `${n(overview?.activeMembersThisWeek)} aktiv diese Woche`,
    ],
    [
      "Offene Kommentare",
      n(overview?.openComments),
      `${n(overview?.commentsResolvedThisWeek)} gelöst diese Woche`,
    ],
  ];

  const dateLine = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <Card className="mb-8 overflow-hidden rounded-2xl p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className={cn(eyebrow, "mb-2 flex items-center gap-1.5 text-primary")}>
            {dateLine}
          </div>
          <p className="text-[28px] leading-tight font-semibold tracking-tight">
            {greeting}, {auth.session.user.name}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {overview
              ? `Du hast ${overview.openComments} offene Kommentare und ${overview.pagesCreatedThisWeek} neue Seiten diese Woche.`
              : " "}
          </p>
        </div>
        <Button onClick={() => setNewPageOpen(true)} className="shrink-0">
          <Plus /> Neue Seite
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {stats.map(([label, value, delta]) => (
          <Card key={label} className="px-4 py-3">
            <div className="text-[13px] text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tracking-tight">
              {isPending && label !== "Mitglieder" ? <Skeleton className="h-8 w-10" /> : value}
            </div>
            <div className="text-[11.5px] text-muted-foreground">{delta}</div>
          </Card>
        ))}
      </div>

      <CreatePageDialog open={newPageOpen} onOpenChange={setNewPageOpen} />
    </Card>
  );
}

// The _auth layout guard guarantees an active organization here, so the
// queries below can run unconditionally.
function RouteComponent() {
  return (
    <DashboardLayout className="p-7">
      <div>
        <h1 className="text-lg font-semibold">Übersicht</h1>
        <p className="text-sm text-muted-foreground">Zuletzt geändert und deine Favoriten.</p>
      </div>
      <HeroCard />
      <div className="grid gap-4 md:grid-cols-2">
        <RecentActivity />
        <Favorites />
      </div>
    </DashboardLayout>
  );
}
