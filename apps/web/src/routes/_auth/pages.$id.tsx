import DashboardLayout from "@/components/layouts/dashboard-layout";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/_auth/pages/$id")({
  component: RouteComponent,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function RouteComponent() {
  const { id } = Route.useParams();

  const {
    data: page,
    isPending,
    isError,
  } = useQuery(orpc.pages.get.queryOptions({ input: { id } }));
  const { data: comments } = useQuery(
    orpc.comments.list.queryOptions({ input: { pageId: id }, enabled: Boolean(page) }),
  );
  // Resolve the owning space for the back-link; cached from the sidebar.
  const { data: spaces } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));
  const space = spaces?.find((s) => s.id === page?.spaceId);

  if (isPending) {
    return (
      <DashboardLayout className="p-7">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-48 w-full" />
      </DashboardLayout>
    );
  }

  if (isError || !page) {
    return (
      <DashboardLayout className="p-7">
        <h1 className="text-lg font-semibold">Seite nicht gefunden</h1>
        <p className="text-sm text-muted-foreground">
          Diese Seite existiert nicht oder du hast keinen Zugriff.
        </p>
      </DashboardLayout>
    );
  }

  const openComments = comments?.filter((c) => !c.resolvedAt && !c.deletedAt) ?? [];

  return (
    <DashboardLayout className="p-7">
      <div className="mx-auto w-full max-w-3xl">
        {space ? (
          <Link
            to="/spaces/$slug"
            params={{ slug: space.slug }}
            className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {space.name}
          </Link>
        ) : null}

        <div className="mt-3 flex items-start gap-3">
          <span className="mt-1 text-2xl leading-none">
            {page.icon ?? <FileText className="size-6 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{page.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
              <span>Zuletzt geändert {dateFormat.format(page.updatedAt)}</span>
            </div>
          </div>
        </div>

        <article className="mt-6 text-[15px] leading-7 whitespace-pre-wrap text-foreground/90">
          {page.textContent.trim() ? (
            page.textContent
          ) : (
            <span className="text-muted-foreground">Diese Seite hat noch keinen Inhalt.</span>
          )}
        </article>

        <section className="mt-10">
          <h2 className="mb-3 text-[15px] font-semibold">
            Kommentare{openComments.length ? ` (${openComments.length})` : ""}
          </h2>
          {!openComments.length ? (
            <p className="text-sm text-muted-foreground">Noch keine Kommentare.</p>
          ) : (
            <div className="space-y-2">
              {openComments.map((comment) => (
                <Card key={comment.id}>
                  <CardContent className="py-3">
                    <div className="text-xs text-muted-foreground">
                      {dateFormat.format(comment.createdAt)}
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
