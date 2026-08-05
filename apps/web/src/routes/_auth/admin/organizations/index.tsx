import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Building2, Search } from "lucide-react";

import { Pager, formatBytes } from "@/components/admin/admin-ui";
import { QueryError } from "@/components/query-error";
import { formatDate } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/admin/organizations/")({
  component: AdminOrganizations,
});

const PAGE_SIZE = 25;
const numberFormat = new Intl.NumberFormat("de-DE");

/** Every tenant on the instance, with the numbers that decide capacity questions. */
function AdminOrganizations() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.organizations.list.queryOptions({
      input: { query: query.trim() || undefined, limit: PAGE_SIZE, offset },
      placeholderData: keepPreviousData,
    }),
  );

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // Narrowing the list invalidates the current page — staying on page
            // 3 of a one-page result looks like a failed request.
            setOffset(0);
          }}
          placeholder="Nach Name oder Kürzel suchen …"
          className="pl-8"
          aria-label="Organisationen suchen"
        />
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Keine Organisation gefunden</EmptyTitle>
            <EmptyDescription>
              {query
                ? `Nichts passt zu „${query.trim()}".`
                : "Auf dieser Instanz existiert noch keine Organisation."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {data.items.map((org) => (
            <li key={org.id}>
              <Link
                to="/admin/organizations/$organizationId"
                params={{ organizationId: org.id }}
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{org.name}</span>
                  <span className="text-xs text-muted-foreground">
                    angelegt {formatDate(org.createdAt)}
                  </span>
                </div>
                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                  <Metric label="Mitglieder" value={numberFormat.format(org.memberCount)} />
                  <Metric label="Spaces" value={numberFormat.format(org.spaceCount)} />
                  <Metric label="Seiten" value={numberFormat.format(org.pageCount)} />
                  <Metric label="Speicher" value={formatBytes(org.storageBytes)} />
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data ? (
        <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}:</dt>
      <dd className="font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
