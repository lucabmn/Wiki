import { orpc } from "@/utils/orpc";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nilovon-wiki/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

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

  const { data: hits, isFetching } = useQuery(
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
                      <div className="truncate text-xs text-muted-foreground">{hit.snippet}</div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
