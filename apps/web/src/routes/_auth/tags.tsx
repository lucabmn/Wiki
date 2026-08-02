import DashboardLayout from "@/components/layouts/dashboard-layout";
import { QueryError } from "@/components/query-error";
import { timeAgo } from "@/lib/format";
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
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, Folder, Search, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type TagsSearch = { space: string; tag: string; q: string };

/** Matches the server's own cap — the page list says "100+" once it's hit. */
const PAGE_LIMIT = 100;

export const Route = createFileRoute("/_auth/tags")({
  validateSearch: (search: Record<string, unknown>): TagsSearch => ({
    space: typeof search.space === "string" ? search.space : "",
    tag: typeof search.tag === "string" ? search.tag : "",
    q: typeof search.q === "string" ? search.q : "",
  }),
  component: RouteComponent,
});

function TagDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}

function RouteComponent() {
  const { space, tag, q } = Route.useSearch();
  const navigate = useNavigate();
  const { data: spaces, isPending: spacesPending } = useQuery(
    orpc.spaces.list.queryOptions({ input: {} }),
  );

  const selectedSpaceId = space || spaces?.[0]?.id || "";
  const selectedSpace = spaces?.find((candidate) => candidate.id === selectedSpaceId);

  const go = (next: Partial<TagsSearch>, replace = false) => {
    navigate({ to: "/tags", search: { space: selectedSpaceId, tag, q, ...next }, replace });
  };

  // Without a `space` param we fall back to the first space — write that choice
  // back into the URL so what's shown and what's shareable agree.
  useEffect(() => {
    const fallback = spaces?.[0]?.id;
    if (space || !fallback) return;
    navigate({ to: "/tags", search: { space: fallback, tag: "", q }, replace: true });
  }, [space, spaces, q, navigate]);

  // The URL owns the filter (shareable, survives reload); the input owns the
  // keystrokes and pushes them over debounced.
  const [term, setTerm] = useState(q);
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    if (term === q) return;
    const timer = setTimeout(() => {
      navigate({ to: "/tags", search: { space: selectedSpaceId, tag, q: term }, replace: true });
    }, 200);
    return () => clearTimeout(timer);
  }, [term, q, selectedSpaceId, tag, navigate]);

  const tagsQuery = useQuery(
    orpc.tags.listWithCounts.queryOptions({
      input: { spaceId: selectedSpaceId },
      enabled: Boolean(selectedSpaceId),
    }),
  );

  // Busiest first — "what is this space mostly about" is the question the list
  // answers on arrival. Unused tags sink to the bottom and are dimmed, since
  // clicking one leads nowhere.
  const sortedTags = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tagsQuery.data ?? [])
      .filter((item) => !needle || item.name.toLowerCase().includes(needle))
      .sort((a, b) => b.pageCount - a.pageCount || a.name.localeCompare(b.name, "de"));
  }, [tagsQuery.data, q]);

  const selectedTag = tagsQuery.data?.find((candidate) => candidate.id === tag) ?? null;
  const pagesQuery = useQuery(
    orpc.tags.listPages.queryOptions({
      input: { tagId: tag, limit: PAGE_LIMIT },
      enabled: Boolean(selectedTag),
    }),
  );
  const pageCount = pagesQuery.data?.length ?? 0;

  return (
    <DashboardLayout className="gap-6 p-7">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Tags</h1>
          <p className="text-sm text-muted-foreground">
            Seiten in {selectedSpace?.name ?? "diesem Space"} nach Thema durchgehen.
          </p>
        </div>
        {spaces && spaces.length > 1 ? (
          <NativeSelect
            aria-label="Space"
            value={selectedSpaceId}
            onChange={(event) => go({ space: event.target.value, tag: "" })}
            className="w-full sm:w-56"
          >
            {spaces.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
      </header>

      {!spacesPending && !spaces?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Folder className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Noch keine Spaces</EmptyTitle>
            <EmptyDescription>Tags gehören zu einem Space — leg zuerst einen an.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="relative sm:max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Tags filtern …"
                className="pl-9"
              />
            </div>

            {tagsQuery.isPending ? (
              <div className="flex flex-wrap gap-2">
                {["w-24", "w-32", "w-20", "w-28", "w-24", "w-36"].map((width) => (
                  <Skeleton key={width} className={cn("h-8 rounded-full", width)} />
                ))}
              </div>
            ) : tagsQuery.isError ? (
              <QueryError error={tagsQuery.error} onRetry={() => tagsQuery.refetch()} />
            ) : sortedTags.length ? (
              // Capped: a space with a hundred tags would otherwise push the
              // result list below the fold, making a chip click look like a no-op.
              <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                {sortedTags.map((item) => {
                  const isSelected = item.id === tag;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => go({ tag: isSelected ? "" : item.id })}
                      className={cn(
                        "flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        isSelected
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border hover:border-primary/30 hover:bg-accent/50",
                        !isSelected && item.pageCount === 0 && "text-muted-foreground",
                      )}
                    >
                      <TagDot color={item.color} />
                      <span className="truncate">{item.name}</span>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          isSelected ? "text-primary/70" : "text-muted-foreground",
                        )}
                      >
                        {item.pageCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : q.trim() ? (
              <p className="text-sm text-muted-foreground">Kein Tag passt auf „{q.trim()}“.</p>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Tag className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>Noch keine Tags</EmptyTitle>
                  <EmptyDescription>
                    Tags entstehen beim Taggen einer Seite in {selectedSpace?.name ?? "dem Space"}.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>

          {tag && !selectedTag && !tagsQuery.isPending && !tagsQuery.isError ? (
            // A deep link can outlive its tag (deleted, or from another space).
            <p className="text-sm text-muted-foreground">
              Dieses Tag gibt es in {selectedSpace?.name ?? "diesem Space"} nicht.
            </p>
          ) : null}

          {selectedTag ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="flex min-w-0 items-baseline gap-2 text-[15px] font-semibold tracking-tight">
                  <TagDot color={selectedTag.color} />
                  <span className="truncate">{selectedTag.name}</span>
                  {pagesQuery.data ? (
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {pageCount === PAGE_LIMIT ? `${PAGE_LIMIT}+` : pageCount}{" "}
                      {pageCount === 1 ? "Seite" : "Seiten"}
                    </span>
                  ) : null}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => go({ tag: "" })}>
                  <X className="size-4" />
                  Filter aufheben
                </Button>
              </div>

              {pagesQuery.isPending ? (
                <Card className="gap-0 p-0">
                  <div className="divide-y divide-border/60">
                    {["w-2/5", "w-3/5", "w-1/3"].map((width) => (
                      <div key={width} className="flex items-center gap-3 px-4 py-3">
                        <Skeleton className="size-8 shrink-0 rounded-lg" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Skeleton className={cn("h-3.5", width)} />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : pagesQuery.isError ? (
                <QueryError error={pagesQuery.error} onRetry={() => pagesQuery.refetch()} />
              ) : pageCount === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FileText className="size-6" />
                    </EmptyMedia>
                    <EmptyTitle>Keine Seiten mit diesem Tag</EmptyTitle>
                    <EmptyDescription>
                      Entweder ist das Tag noch unbenutzt, oder die Seiten sind für dich nicht
                      sichtbar.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Card className="gap-0 p-0">
                  <div className="divide-y divide-border/60">
                    {pagesQuery.data?.map((page) => (
                      <Link
                        key={page.pageId}
                        to="/pages/$id"
                        params={{ id: page.pageId }}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                          {page.icon ?? <FileText className="size-4 text-muted-foreground" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{page.title}</span>
                          <span className="text-xs text-muted-foreground">
                            Aktualisiert {timeAgo(page.updatedAt)}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
              )}
            </section>
          ) : null}
        </>
      )}
    </DashboardLayout>
  );
}
