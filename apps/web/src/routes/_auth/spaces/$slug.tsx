import { CreatePageDialog } from "@/components/create-page-dialog";
import DashboardLayout from "@/components/layouts/dashboard-layout";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { STATUS_LABEL, VISIBILITY_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, FilePlus, FileText, Folder, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_auth/spaces/$slug")({
  component: RouteComponent,
});

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** One labelled row in the space info rail. */
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] font-medium">{children}</span>
    </div>
  );
}

function RouteComponent() {
  const { slug } = Route.useParams();
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { auth } = useRouteContext({ from: "/_auth" });
  const nameOf = (userId: string | null) => {
    if (!userId) return "—";
    return (
      auth.organization.members.find((member) => member.user.id === userId)?.user.name ??
      "Unbekannt"
    );
  };

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

  const filtered = useMemo(() => {
    if (!pages) return [];
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q));
  }, [pages, query]);

  if (spacesPending) {
    return (
      <DashboardLayout className="p-7">
        <div className="mx-auto w-full max-w-6xl">
          <Skeleton className="h-11 w-64" />
          <Skeleton className="mt-6 h-48 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!space) {
    return (
      <DashboardLayout className="p-7">
        <div className="mx-auto w-full max-w-6xl">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder className="size-6" />
              </EmptyMedia>
              <EmptyTitle>Space nicht gefunden</EmptyTitle>
              <EmptyDescription>
                Der Space „{slug}“ existiert nicht oder du hast keinen Zugriff.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link to="/spaces">
                <Button variant="outline">Zu allen Spaces</Button>
              </Link>
            </EmptyContent>
          </Empty>
        </div>
      </DashboardLayout>
    );
  }

  const total = pages?.length ?? 0;
  const accent = space.color ?? DEFAULT_SPACE_COLOR;

  return (
    <DashboardLayout className="p-7">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          to="/spaces"
          className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Alle Spaces
        </Link>

        {/* Hero: tinted band keyed to the space color so each space reads as its
            own place, not another generic list header. */}
        <div
          className="mt-3 flex flex-wrap items-start justify-between gap-4 rounded-xl border p-5"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)` }}
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
              style={{ backgroundColor: accent }}
            >
              {space.icon ? (
                <span className="text-xl leading-none">{space.icon}</span>
              ) : (
                <span className="text-xl font-semibold leading-none">
                  {space.name.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{space.name}</h1>
                <Badge variant="outline" className="shrink-0 bg-background/60">
                  {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
                </Badge>
              </div>
              {space.description ? (
                <p className="mt-1 line-clamp-2 max-w-prose text-sm text-muted-foreground">
                  {space.description}
                </p>
              ) : null}
            </div>
          </div>
          <Button onClick={() => setCreatePageOpen(true)}>
            <Plus className="size-4" />
            Neue Seite
          </Button>
        </div>

        <div className="mt-7 flex flex-col gap-8 lg:flex-row">
          {/* Main column: pages list + search */}
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">
                Seiten
                {total > 0 ? <span className="ml-1.5 text-muted-foreground">{total}</span> : null}
              </h2>
              {total > 0 && (
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Seiten durchsuchen …"
                    className="pl-9"
                    aria-label="Seiten durchsuchen"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Suche leeren"
                      className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {pagesPending ? (
              <Card className="gap-0 py-0">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="m-4 h-6" />
                ))}
              </Card>
            ) : total === 0 ? (
              <Empty className="rounded-xl border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilePlus className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>Noch keine Seiten</EmptyTitle>
                  <EmptyDescription>
                    Dieser Space ist leer. Erstelle die erste Seite, um Inhalte zu sammeln.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setCreatePageOpen(true)}>
                    <Plus className="size-4" />
                    Neue Seite
                  </Button>
                </EmptyContent>
              </Empty>
            ) : filtered.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Keine Seite passt zu „{query.trim()}“.
                </CardContent>
              </Card>
            ) : (
              <Card className="gap-0 py-0">
                {filtered.map((page) => (
                  <Link key={page.id} to="/pages/$id" params={{ id: page.id }} className="block">
                    <div className="group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-accent/50">
                      {page.icon ? (
                        <span className="leading-none">{page.icon}</span>
                      ) : (
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm">{page.title || "Ohne Titel"}</span>
                      {page.status !== "published" ? (
                        <Badge variant="outline" className="shrink-0 text-[11px]">
                          {STATUS_LABEL[page.status] ?? page.status}
                        </Badge>
                      ) : null}
                      <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </Link>
                ))}
              </Card>
            )}
          </section>

          {/* Info rail: space metadata, mirrors the page-detail aside pattern. */}
          <aside className="w-full shrink-0 lg:w-64">
            <Card className="gap-0 p-4">
              <h3 className="mb-3 text-[13px] font-semibold">Details</h3>
              <div className="flex flex-col gap-2.5">
                <MetaRow label="Sichtbarkeit">
                  {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
                </MetaRow>
                <MetaRow label="Seiten">{total}</MetaRow>
                <Separator />
                <MetaRow label="Erstellt von">{nameOf(space.createdBy)}</MetaRow>
                <MetaRow label="Erstellt am">{dateFormat.format(space.createdAt)}</MetaRow>
              </div>
            </Card>
          </aside>
        </div>
      </div>

      <CreatePageDialog open={createPageOpen} spaceId={space.id} onOpenChange={setCreatePageOpen} />
    </DashboardLayout>
  );
}
