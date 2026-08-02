import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { Tag } from "@nilovon-wiki/api/schemas/tag";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@nilovon-wiki/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@nilovon-wiki/ui/components/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TagIcon, X } from "lucide-react";
import { useState } from "react";

/**
 * The page's tag row: shows the tags attached to a page and — for callers with
 * write access — lets them attach an existing space tag, detach one, or create
 * a new tag inline from whatever was typed into the picker.
 *
 * Tags are space-scoped (the server rejects attaching a tag from another
 * space), so the picker lists `tag.list` for the page's own space.
 */
export function PageTags({
  pageId,
  spaceId,
  canEdit,
}: {
  pageId: string;
  spaceId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const pageTagsOptions = orpc.tags.listForPage.queryOptions({ input: { pageId } });
  const { data: tags } = useQuery(pageTagsOptions);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const spaceTagsOptions = orpc.tags.list.queryOptions({ input: { spaceId }, enabled: open });
  const { data: spaceTags } = useQuery(spaceTagsOptions);

  // attach/detach both return the page's new tag list, so we can seed the cache
  // straight from the response instead of waiting on a refetch.
  const applyResult = (next: Tag[]) => {
    queryClient.setQueryData(pageTagsOptions.queryKey, next);
  };

  const attach = useMutation(
    orpc.tags.attach.mutationOptions({ onSuccess: applyResult, onError: toastError }),
  );
  const detach = useMutation(
    orpc.tags.detach.mutationOptions({ onSuccess: applyResult, onError: toastError }),
  );
  const create = useMutation(
    orpc.tags.create.mutationOptions({
      onSuccess: (tag) => {
        queryClient.invalidateQueries({ queryKey: orpc.tags.list.key() });
        attach.mutate({ pageId, tagId: tag.id });
      },
      onError: toastError,
    }),
  );

  const attached = tags ?? [];
  const attachedIds = new Set(attached.map((tag) => tag.id));
  const available = (spaceTags ?? []).filter((tag) => !attachedIds.has(tag.id));
  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 &&
    !(spaceTags ?? []).some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());

  if (!attached.length && !canEdit) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attached.map((tag) => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="gap-1 pr-1"
          style={tag.color ? { backgroundColor: `${tag.color}20`, color: tag.color } : undefined}
        >
          <a
            href={`/tags?space=${encodeURIComponent(spaceId)}&tag=${encodeURIComponent(tag.id)}`}
            className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tag.name}
          </a>
          {canEdit ? (
            <button
              type="button"
              aria-label={`Tag ${tag.name} entfernen`}
              disabled={detach.isPending}
              onClick={() => detach.mutate({ pageId, tagId: tag.id })}
              className="rounded-sm opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </Badge>
      ))}

      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery("");
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                {attached.length ? <Plus className="size-3" /> : <TagIcon className="size-3" />}
                {attached.length ? "Tag" : "Tag hinzufügen"}
              </button>
            }
          />
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Tag suchen oder anlegen …"
              />
              <CommandList>
                <CommandEmpty>Keine Tags in diesem Space.</CommandEmpty>
                {available.length ? (
                  <CommandGroup>
                    {available.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => {
                          attach.mutate({ pageId, tagId: tag.id });
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color ?? "var(--muted-foreground)" }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                {canCreate ? (
                  <CommandGroup>
                    <CommandItem
                      value={`__create__${trimmed}`}
                      onSelect={() => {
                        create.mutate({ spaceId, name: trimmed });
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <Plus className="size-3.5" />
                      <span className="truncate">„{trimmed}" anlegen</span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
