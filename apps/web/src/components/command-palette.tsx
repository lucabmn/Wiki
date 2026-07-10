import { QueryError } from "@/components/query-error";
import { splitSnippet } from "@/lib/snippet";
import { orpc } from "@/utils/orpc";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@nilovon-wiki/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Search } from "lucide-react";
import { useEffect, useState } from "react";

/** Renders a `ts_headline` snippet with matched terms bolded. */
function renderSnippet(snippet: string) {
  return splitSnippet(snippet).map((part, i) =>
    part.match ? (
      <strong key={i} className="font-medium text-foreground">
        {part.value}
      </strong>
    ) : (
      part.value
    ),
  );
}

/**
 * ⌘K search palette. Runs the server-side full-text search (already scoped to
 * readable spaces by the API) and navigates to the chosen page. cmdk's own
 * client-side filtering is disabled — the ranking comes from the backend.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  // Toggle on ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Debounce so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const {
    data: hits,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery(
    orpc.search.pages.queryOptions({
      input: { query: debounced },
      enabled: open && debounced.length >= 2,
    }),
  );

  const select = (pageId: string) => {
    onOpenChange(false);
    setQuery("");
    navigate({ to: "/pages/$id", params: { id: pageId } });
  };

  const seeAll = () => {
    const trimmed = query.trim();
    onOpenChange(false);
    setQuery("");
    navigate({ to: "/search", search: { q: trimmed, space: "" } });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Suche"
      description="Seiten suchen"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Seiten suchen …" value={query} onValueChange={setQuery} />
        <CommandList>
          {debounced.length < 2 ? (
            <CommandEmpty>Tippe, um zu suchen.</CommandEmpty>
          ) : isFetching && !hits?.length ? (
            <CommandEmpty>Suche …</CommandEmpty>
          ) : isError ? (
            <QueryError
              compact
              error={error}
              onRetry={() => refetch()}
              className="justify-center py-4"
            />
          ) : !hits?.length ? (
            <CommandEmpty>Keine Treffer.</CommandEmpty>
          ) : (
            <CommandGroup heading="Seiten">
              {hits.map((hit) => (
                <CommandItem
                  key={hit.pageId}
                  value={hit.pageId}
                  onSelect={() => select(hit.pageId)}
                >
                  {hit.icon ? (
                    <span className="leading-none">{hit.icon}</span>
                  ) : (
                    <FileText className="size-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{hit.title}</div>
                    {hit.snippet ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {renderSnippet(hit.snippet)}
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {hits?.length ? (
            <>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="__see_all__" onSelect={seeAll}>
                  <Search className="size-4 text-muted-foreground" />
                  <span>Alle Ergebnisse für „{debounced}“ ansehen</span>
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
