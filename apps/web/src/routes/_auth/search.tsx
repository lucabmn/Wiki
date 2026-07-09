import DashboardLayout from "@/components/layouts/dashboard-layout";
import { orpc } from "@/utils/orpc";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

type SearchParams = { q: string; space: string };

export const Route = createFileRoute("/_auth/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : "",
    space: typeof search.space === "string" ? search.space : "",
  }),
  component: RouteComponent,
});

/**
 * Renders a `ts_headline` snippet, turning its `<b>…</b>` match markers into
 * highlighted spans. Split-based (not HTML injection), so page text can't smuggle
 * markup into the DOM.
 */
function HighlightedSnippet({ snippet }: { snippet: string }) {
  if (!snippet) return null;
  // Split on the `<b>…</b>` markers ts_headline inserts around matches; the odd
  // segments are the highlighted terms.
  const segments = snippet.split(/<\/?b>/);
  return (
    <span className="text-sm text-muted-foreground">
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <mark key={`${index}-${segment}`} className="rounded bg-amber-500/20 text-foreground">
            {segment}
          </mark>
        ) : (
          segment
        ),
      )}
    </span>
  );
}

function RouteComponent() {
  const { q, space } = Route.useSearch();
  const navigate = useNavigate();

  // Local input mirrors the URL `q`; the URL is the source of truth for the
  // query (so results are shareable / survive reload) and is updated debounced.
  const [term, setTerm] = useState(q);
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => {
      navigate({ to: "/search", search: { q: trimmed, space }, replace: true });
    }, 200);
    return () => clearTimeout(timer);
  }, [term, q, space, navigate]);

  const { data: spaces } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));

  const query = q.trim();
  const enabled = query.length >= 2;
  const { data: hits, isFetching } = useQuery(
    orpc.search.pages.queryOptions({
      input: { query, spaceId: space || undefined, limit: 50 },
      enabled,
    }),
  );

  return (
    <DashboardLayout className="p-7">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-lg font-semibold">Suche</h1>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Seiten durchsuchen …"
              className="pl-9"
            />
          </div>
          <NativeSelect
            value={space}
            onChange={(event) =>
              navigate({ to: "/search", search: { q: query, space: event.target.value } })
            }
            className="w-48"
          >
            <NativeSelectOption value="">Alle Spaces</NativeSelectOption>
            {spaces?.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="mt-6">
          {!enabled ? (
            <p className="text-sm text-muted-foreground">Tippe mindestens zwei Zeichen.</p>
          ) : isFetching && !hits?.length ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !hits?.length ? (
            <p className="text-sm text-muted-foreground">Keine Treffer für „{query}“.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{hits.length} Treffer</p>
              <ul className="space-y-1">
                {hits.map((hit) => (
                  <li key={hit.pageId}>
                    <Link
                      to="/pages/$id"
                      params={{ id: hit.pageId }}
                      className="flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-accent/50"
                    >
                      <span className="mt-0.5 text-base leading-none">
                        {hit.icon ?? <FileText className="size-4 text-muted-foreground" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{hit.title}</span>
                        <HighlightedSnippet snippet={hit.snippet} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
