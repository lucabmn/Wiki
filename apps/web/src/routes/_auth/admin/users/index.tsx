import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search, ShieldBan, Users, X } from "lucide-react";

import { InstanceRoleBadge, Pager } from "@/components/admin/admin-ui";
import { QueryError } from "@/components/query-error";
import { formatDate, initials, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
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
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";

export const Route = createFileRoute("/_auth/admin/users/")({
  component: AdminUsers,
});

const PAGE_SIZE = 25;
const FILTERS = [
  { value: "all", label: "Alle" },
  { value: "admins", label: "Instanz-Admins" },
  { value: "banned", label: "Gesperrt" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

/** Every account on the instance — across all organizations, not just the active one. */
function AdminUsers() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const search = useDebounced(query, 250);

  // Any narrowing invalidates the current page; staying on page 4 of a
  // three-page result would show an empty list that looks like a failure.
  useEffect(() => setOffset(0), [search, filter]);

  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.users.list.queryOptions({
      input: { query: search || undefined, filter, limit: PAGE_SIZE, offset },
      // Keeps the previous page on screen while the next one loads, so typing
      // in the search box does not flash the list away on every keystroke.
      placeholderData: keepPreviousData,
    }),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList>
            {FILTERS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nach Name oder E-Mail suchen …"
            className="pl-8"
            aria-label="Benutzer suchen"
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              onClick={() => setQuery("")}
              aria-label="Suche zurücksetzen"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Keine Treffer</EmptyTitle>
            <EmptyDescription>
              {search
                ? `Kein Konto passt zu „${search}".`
                : "In dieser Ansicht gibt es keine Konten."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {data.items.map((entry) => (
            <li key={entry.id}>
              <Link
                to="/admin/users/$userId"
                params={{ userId: entry.id }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-accent/40"
              >
                <Avatar className="size-9 shrink-0">
                  {entry.image ? <AvatarImage src={entry.image} alt="" /> : null}
                  <AvatarFallback>{initials(entry.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{entry.name}</span>
                    <InstanceRoleBadge roles={entry.roles} />
                    {entry.banned ? (
                      <Badge variant="destructive" className="gap-1">
                        <ShieldBan className="size-3" aria-hidden />
                        Gesperrt
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{entry.email}</p>
                </div>
                <dl className="hidden shrink-0 gap-6 text-right sm:flex">
                  <Stat label="Orgs" value={entry.organizationCount} />
                  <Stat label="Sitzungen" value={entry.activeSessionCount} />
                  <div className="min-w-24">
                    <dt className="text-xs text-muted-foreground">Zuletzt</dt>
                    <dd className="text-sm">
                      {entry.lastSeenAt ? timeAgo(entry.lastSeenAt) : "—"}
                    </dd>
                  </div>
                  <div className="min-w-24">
                    <dt className="text-xs text-muted-foreground">Registriert</dt>
                    <dd className="text-sm">{formatDate(entry.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data ? (
        <Card className="border-none bg-transparent p-0 shadow-none">
          <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-14">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/** Keeps the search box responsive without firing a query per keystroke. */
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
