import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, FileText, Mail } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { QueryError } from "@/components/query-error";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { ACTION_LABEL, ROLE_LABEL, ROLE_VARIANT, STATUS_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/users/$id")({
  component: RouteComponent,
});

/**
 * Every list on this page is scoped server-side to the spaces the *viewer* may
 * read, so two people can see different contribution totals for the same
 * profile. That's intentional — a profile must never widen access.
 */
function RouteComponent() {
  const { id } = Route.useParams();
  const { auth } = Route.useRouteContext();
  const isSelf = auth.session.user.id === id;

  const {
    data: profile,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(orpc.users.get.queryOptions({ input: { userId: id } }));

  if (isPending) {
    return (
      <DashboardLayout className="p-7">
        <Skeleton className="h-4 w-32" />
        <Card className="flex-row items-center gap-4 p-6">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3.5 w-64" />
          </div>
        </Card>
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout className="p-7">
        <BackLink />
        <QueryError error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  const stats: [string, number, string][] = [
    ["Seiten erstellt", profile.stats.pagesCreated, "Erstellt"],
    ["Seiten bearbeitet", profile.stats.pagesEdited, "Zuletzt bearbeitet"],
    ["Kommentare", profile.stats.comments, "Geschrieben"],
    ["Spaces", profile.stats.spacesContributed, "Mit Beiträgen"],
  ];

  return (
    <DashboardLayout className="p-7">
      <BackLink />

      <Card className="gap-4 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar className="size-16 shrink-0">
            {profile.image ? <AvatarImage src={profile.image} alt="" /> : null}
            <AvatarFallback className="text-lg">{initials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
              {profile.roles.map((role) => (
                <Badge key={role} variant={ROLE_VARIANT[role] ?? "outline"}>
                  {ROLE_LABEL[role] ?? role}
                </Badge>
              ))}
            </div>
            <a
              href={`mailto:${profile.email}`}
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
            >
              <Mail className="size-3.5" />
              {profile.email}
            </a>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Mitglied seit {formatDate(profile.joinedAt)}
              {profile.stats.lastActiveAt
                ? ` · zuletzt aktiv ${timeAgo(profile.stats.lastActiveAt)}`
                : " · noch keine Aktivität"}
            </p>
          </div>
          {isSelf ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/settings/profile" />}
            >
              Profil bearbeiten
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value, hint]) => (
          <Card key={label} className="gap-0 px-4 py-3">
            <div className="text-[13px] text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <div className="text-[11.5px] text-muted-foreground">{hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageList
          userId={id}
          kind="edited"
          title="Zuletzt bearbeitet"
          empty={`${profile.name} hat noch keine Seite bearbeitet, die du sehen kannst.`}
        />
        <PageList
          userId={id}
          kind="created"
          title="Erstellte Seiten"
          empty={`${profile.name} hat noch keine Seite erstellt, die du sehen kannst.`}
        />
      </div>

      <ActivityFeed userId={id} name={profile.name} />
    </DashboardLayout>
  );
}

function BackLink() {
  return (
    <Link
      to="/users"
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Alle Personen
    </Link>
  );
}

/** Pages the user created or last edited, newest first. */
function PageList({
  userId,
  kind,
  title,
  empty,
}: {
  userId: string;
  kind: "created" | "edited";
  title: string;
  empty: string;
}) {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.users.pages.queryOptions({ input: { userId, kind, limit: 8 } }),
  );

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold">{title}</h2>
      {isPending ? (
        <Card className="gap-0 py-0">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0"
            >
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </Card>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <Card className="px-4 py-6">
          <p className="text-sm text-muted-foreground">{empty}</p>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {data.map((page) => (
            <Link
              key={page.id}
              to="/pages/$id"
              params={{ id: page.id }}
              className="group flex items-center gap-3 border-b border-border px-4 py-3.5 transition-colors last:border-0 hover:bg-muted/50"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                style={{ backgroundColor: page.spaceColor ?? DEFAULT_SPACE_COLOR }}
              >
                {page.icon ? (
                  <span className="text-base leading-none">{page.icon}</span>
                ) : (
                  <FileText className="size-4.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium group-hover:text-primary">
                  {page.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {page.spaceName} · {timeAgo(kind === "created" ? page.createdAt : page.updatedAt)}
                </div>
              </div>
              {page.status === "published" ? null : (
                <Badge variant="outline" className="shrink-0">
                  {STATUS_LABEL[page.status] ?? page.status}
                </Badge>
              )}
            </Link>
          ))}
        </Card>
      )}
    </section>
  );
}

/** The org-wide feed narrowed to this actor — what they did, most recent first. */
function ActivityFeed({ userId, name }: { userId: string; name: string }) {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.activity.list.queryOptions({ input: { actorId: userId, limit: 20 } }),
  );

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold">Aktivität</h2>
      {isPending ? (
        <Card className="gap-0 py-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="border-b border-border px-4 py-3 last:border-0">
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          ))}
        </Card>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <Card className="px-4 py-6">
          <p className="text-sm text-muted-foreground">Keine sichtbare Aktivität von {name}.</p>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {data.map((entry) => {
            const row = (
              <>
                <span className="flex size-2 shrink-0 rounded-full bg-primary/60" />
                <span className="min-w-0 flex-1 truncate text-[14px]">
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </span>
                {entry.space?.name ? (
                  <Badge variant="outline" className="shrink-0">
                    {entry.space.name}
                  </Badge>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(entry.createdAt)}
                </span>
              </>
            );
            const className =
              "flex items-center gap-3 border-b border-border px-4 py-3 last:border-0";
            return entry.pageId ? (
              <Link
                key={entry.id}
                to="/pages/$id"
                params={{ id: entry.pageId }}
                className={`${className} transition-colors hover:bg-muted/50`}
              >
                {row}
              </Link>
            ) : (
              <div key={entry.id} className={className}>
                {row}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
