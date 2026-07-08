import DashboardLayout from "@/components/layouts/dashboard-layout";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

// Human-readable German labels for each audit action.
const ACTION_LABEL: Record<string, string> = {
  "space.created": "Space erstellt",
  "space.updated": "Space aktualisiert",
  "space.archived": "Space archiviert",
  "page.created": "Seite erstellt",
  "page.updated": "Seite bearbeitet",
  "page.published": "Seite veröffentlicht",
  "page.moved": "Seite verschoben",
  "page.archived": "Seite archiviert",
  "page.restored": "Seite wiederhergestellt",
  "page.deleted": "Seite gelöscht",
  "comment.created": "Kommentar hinzugefügt",
  "comment.resolved": "Kommentar gelöst",
  "attachment.uploaded": "Datei hochgeladen",
};

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

function RecentActivity({ enabled }: { enabled: boolean }) {
  const { data, isPending } = useQuery(
    orpc.activity.list.queryOptions({ input: { limit: 5 }, enabled }),
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Zuletzt bearbeitet</h2>
        <button
          type="button"
          onClick={() => console.log("spaces")}
          className="text-[13px] font-medium text-primary transition-colors hover:text-primary/80"
        >
          Alle Spaces
        </button>
      </div>
      {isPending && (
        <Card className="gap-0 py-0">
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
          <Skeleton className="h-22 items-center border-b" />
        </Card>
      )}
      <Card className="gap-0 py-0">
        {data?.map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => console.log("select page")}
            className="group flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/50"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
              style={{ backgroundColor: `${r.space?.color ?? "#1E6DE1"}` }}
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
    </section>
  );
}

function Favorites({ enabled }: { enabled: boolean }) {
  const { data, isPending } = useQuery(orpc.me.listFavorites.queryOptions({ input: {}, enabled }));

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
              <div key={page.id} className="flex items-center gap-2 text-sm">
                {page.icon ? (
                  <span className="leading-none">{page.icon}</span>
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
                <span className="truncate">{page.title}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function HeroCard() {
  const { auth } = Route.useRouteContext();

  const now = new Date();

  const greeting =
    now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 ? "Guten Tag" : "Guten Abend";

  const stats: [string, string, string][] = [
    // TODO: Get real site data
    ["Seiten", "48", "+3 diese Woche"],
    // TODO: Filter real active member
    [
      "Mitglieder",
      auth.organization.members.length.toString(),
      `${auth.organization.members.filter((member) => member.createdAt).length} aktiv jetzt`,
    ],
    // TODO: Get real comment data
    ["Offene Kommentare", "3", "2 dir zugewiesen"],
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
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
            {greeting}, {auth.session.user.name}.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Du hast 2 neue Kommentare und 3 aktualisierte Seiten seit gestern.
          </p>
        </div>
        <Button onClick={() => console.log("edit")} className="shrink-0">
          <Plus /> Neue Seite
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {stats.map(([label, value, delta]) => (
          <Card key={label} className="px-4 py-3">
            <div className="text-[13px] text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <div className="text-[11.5px] text-muted-foreground">{delta}</div>
          </Card>
        ))}
      </div>
    </Card>
  );
}

function RouteComponent() {
  const { data: session } = authClient.useSession();
  const hasActiveOrg = Boolean(session?.session.activeOrganizationId);

  return (
    <DashboardLayout className="p-7">
      <div>
        <h1 className="text-lg font-semibold">Übersicht</h1>
        <p className="text-sm text-muted-foreground">
          {hasActiveOrg
            ? "Zuletzt geändert und deine Favoriten."
            : "Wähle oder erstelle eine Organisation, um loszulegen."}
        </p>
      </div>
      <HeroCard />
      <div className="grid gap-4 md:grid-cols-2">
        <RecentActivity enabled={hasActiveOrg} />
        <Favorites enabled={hasActiveOrg} />
      </div>
    </DashboardLayout>
  );
}
