import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CreateSpaceDialog } from "@/components/create-space-dialog";
import { QueryError } from "@/components/query-error";
import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { VISIBILITY_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FolderPlus, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_auth/spaces/")({
  component: RouteComponent,
});

type Visibility = "public" | "private" | "restricted";

// Filter pills: "all" plus one per visibility. Kept as a plain button row rather
// than a ToggleGroup so selection is a single string, not a value array.
const VISIBILITY_FILTERS: { value: "all" | Visibility; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "public", label: VISIBILITY_LABEL.public },
  { value: "private", label: VISIBILITY_LABEL.private },
  { value: "restricted", label: VISIBILITY_LABEL.restricted },
];

function RouteComponent() {
  const {
    data: spaces,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));

  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<"all" | Visibility>("all");

  const filtered = useMemo(() => {
    if (!spaces) return [];
    const q = query.trim().toLowerCase();
    return spaces.filter((space) => {
      if (visibility !== "all" && space.visibility !== visibility) return false;
      if (!q) return true;
      return (
        space.name.toLowerCase().includes(q) ||
        (space.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [spaces, query, visibility]);

  const total = spaces?.length ?? 0;

  const clearFilters = () => {
    setQuery("");
    setVisibility("all");
  };

  return (
    <DashboardLayout className="p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Spaces</h1>
          <p className="text-sm text-muted-foreground">
            {isPending
              ? "Spaces werden geladen …"
              : total === 0
                ? "Noch keine Spaces vorhanden."
                : `${total} ${total === 1 ? "Space" : "Spaces"}, auf die du Zugriff hast.`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Neuer Space
        </Button>
      </header>

      {/* Toolbar: search + visibility filter. Hidden until there is something to
          search, so an empty account isn't cluttered with dead controls. */}
      {(isPending || total > 0) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Spaces durchsuchen …"
              className="pl-9"
              aria-label="Spaces durchsuchen"
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

          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {VISIBILITY_FILTERS.map((f) => (
              <Button
                key={f.value}
                type="button"
                size="sm"
                variant={visibility === f.value ? "default" : "outline"}
                onClick={() => setVisibility(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : total === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlus className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Noch keine Spaces</EmptyTitle>
            <EmptyDescription>
              Ein Space bündelt zusammengehörige Seiten. Leg deinen ersten an, um loszulegen.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Neuer Space
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Keine Treffer</EmptyTitle>
            <EmptyDescription>
              Kein Space passt zu deiner Suche{query.trim() ? ` „${query.trim()}“` : ""}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={clearFilters}>
              Filter zurücksetzen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((space) => (
            <Link key={space.id} to="/spaces/$slug" params={{ slug: space.slug }} className="block">
              <Card className="h-full gap-2.5 p-4 transition-colors hover:border-primary/40 hover:bg-accent/40">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                    style={{ backgroundColor: space.color ?? DEFAULT_SPACE_COLOR }}
                  >
                    {space.icon ? (
                      <span className="text-base leading-none">{space.icon}</span>
                    ) : (
                      space.name.charAt(0).toUpperCase()
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{space.name}</span>
                  <Badge variant="outline" className="shrink-0">
                    {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
                  </Badge>
                </div>
                <p
                  className={cn(
                    "line-clamp-2 text-sm text-muted-foreground",
                    !space.description && "italic opacity-70",
                  )}
                >
                  {space.description || "Keine Beschreibung"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateSpaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </DashboardLayout>
  );
}
