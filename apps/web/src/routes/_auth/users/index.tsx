import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search, UsersRound, X } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { QueryError } from "@/components/query-error";
import { formatDate, initials } from "@/lib/format";
import { ROLE_LABEL, ROLE_VARIANT } from "@/lib/labels";
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

export const Route = createFileRoute("/_auth/users/")({
  component: RouteComponent,
});

/**
 * The people directory — every member of the active organization, each linking
 * to their profile. Unlike `/settings/members` this is read-only and open to
 * every member, so it needs no permission gate.
 */
function RouteComponent() {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.users.list.queryOptions({ input: {} }),
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (user) => user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <DashboardLayout className="p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Personen</h1>
          <p className="text-sm text-muted-foreground">
            {isPending
              ? "Mitglieder werden geladen …"
              : `${data?.length ?? 0} ${data?.length === 1 ? "Mitglied" : "Mitglieder"} in dieser Organisation.`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nach Name oder E-Mail suchen …"
            className="pl-8"
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <X className="size-4" />
              <span className="sr-only">Suche zurücksetzen</span>
            </Button>
          ) : null}
        </div>
      </header>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="flex-row items-center gap-3 p-4">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRound />
            </EmptyMedia>
            <EmptyTitle>Niemand gefunden</EmptyTitle>
            <EmptyDescription>
              {query
                ? "Keine Person passt zu deiner Suche."
                : "Diese Organisation hat noch keine Mitglieder."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((user) => (
            <Link key={user.id} to="/users/$id" params={{ id: user.id }} className="group">
              <Card className="h-full flex-row items-center gap-3 p-4 transition-colors group-hover:border-primary/40 group-hover:bg-muted/40">
                <Avatar size="lg" className="shrink-0">
                  {user.image ? <AvatarImage src={user.image} alt="" /> : null}
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium group-hover:text-primary">
                    {user.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {user.roles.length > 0 ? (
                      user.roles.map((role) => (
                        <Badge key={role} variant={ROLE_VARIANT[role] ?? "outline"}>
                          {ROLE_LABEL[role] ?? role}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">
                        Dabei seit {formatDate(user.joinedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
