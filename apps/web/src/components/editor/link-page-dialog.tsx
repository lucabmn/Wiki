import { orpc } from "@/utils/orpc";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nilovon-wiki/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";

/**
 * Searchable picker for linking to another page in the same space. Reuses the
 * full-text search endpoint (scoped to `spaceId`); selecting a hit hands its id
 * and title back so the editor can insert an internal link.
 */
export function LinkPageDialog({
  spaceId,
  open,
  onOpenChange,
  onPick,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (page: { id: string; title: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const enabled = open && query.trim().length >= 2;
  const { data: hits } = useQuery(
    orpc.search.pages.queryOptions({
      input: { query: query.trim(), spaceId, limit: 8 },
      enabled,
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Seite verknüpfen</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Seite in diesem Space suchen …"
          />
          <CommandList>
            <CommandEmpty>
              {enabled ? "Keine Treffer." : "Tippe mindestens zwei Zeichen."}
            </CommandEmpty>
            {hits?.length ? (
              <CommandGroup>
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.pageId}
                    value={hit.pageId}
                    onSelect={() => {
                      onPick({ id: hit.pageId, title: hit.title });
                      onOpenChange(false);
                      setQuery("");
                    }}
                  >
                    <span className="text-sm leading-none">
                      {hit.icon ?? <FileText className="size-4" />}
                    </span>
                    <span className="truncate">{hit.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
