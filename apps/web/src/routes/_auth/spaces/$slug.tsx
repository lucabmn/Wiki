import DashboardLayout from "@/components/layouts/dashboard-layout";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { VISIBILITY_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, Folder } from "lucide-react";

export const Route = createFileRoute("/_auth/spaces/$slug")({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();

  // The space list is org-scoped and already cached from the sidebar, so
  // resolving the slug here is a lookup, not an extra round-trip in practice.
  const { data: spaces, isPending: spacesPending } = useQuery(
    orpc.spaces.list.queryOptions({ input: {} }),
  );
  const space = spaces?.find((s) => s.slug === slug);

  const { data: pages, isPending: pagesPending } = useQuery(
    orpc.pages.list.queryOptions({
      input: { spaceId: space?.id ?? "", parentId: null },
      enabled: Boolean(space),
    }),
  );

  if (spacesPending) {
    return (
      <DashboardLayout className="p-7">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-4 h-40 w-full" />
      </DashboardLayout>
    );
  }

  if (!space) {
    return (
      <DashboardLayout className="p-7">
        <h1 className="text-lg font-semibold">Space nicht gefunden</h1>
        <p className="text-sm text-muted-foreground">
          Der Space „{slug}“ existiert nicht oder du hast keinen Zugriff.
        </p>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout className="p-7">
      <div className="flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ backgroundColor: space.color ?? DEFAULT_SPACE_COLOR }}
        >
          {space.icon ? (
            <span className="text-lg leading-none">{space.icon}</span>
          ) : (
            <Folder className="size-5.5" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight">{space.name}</h1>
            <Badge variant="outline" className="shrink-0">
              {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
            </Badge>
          </div>
          {space.description ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{space.description}</p>
          ) : null}
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-[15px] font-semibold">Seiten</h2>
        <Card className="gap-0 py-0">
          {pagesPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="m-4 h-6" />)
          ) : !pages?.length ? (
            <CardContent className="py-6">
              <p className="text-sm text-muted-foreground">Noch keine Seiten in diesem Space.</p>
            </CardContent>
          ) : (
            pages.map((page) => (
              <Link to="/pages/$id" params={{ id: page.id }}>
                <div
                  key={page.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                >
                  {page.icon ? (
                    <span className="leading-none">{page.icon}</span>
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm">{page.title}</span>
                </div>
              </Link>
            ))
          )}
        </Card>
      </section>
    </DashboardLayout>
  );
}
