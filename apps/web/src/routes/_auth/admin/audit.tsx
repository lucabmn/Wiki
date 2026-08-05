import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";

import { Pager } from "@/components/admin/admin-ui";
import { QueryError } from "@/components/query-error";
import { ADMIN_AUDIT_LABEL, describeAuditMetadata } from "@/lib/admin-audit";
import { formatDateTime, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/admin/audit")({
  component: AdminAudit,
});

const PAGE_SIZE = 50;
type AuditAction = keyof typeof ADMIN_AUDIT_LABEL;

/**
 * The instance audit log: every admin action against somebody else's account.
 *
 * Separate from the per-organization activity feed on purpose — these events
 * belong to no organization, and an org owner must not see who was banned or
 * impersonated elsewhere on the instance.
 */
function AdminAudit() {
  const [action, setAction] = useState<AuditAction | "">("");
  const [offset, setOffset] = useState(0);

  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.audit.list.queryOptions({
      input: { action: action || undefined, limit: PAGE_SIZE, offset },
      placeholderData: keepPreviousData,
    }),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Fortlaufend, unveränderlich. Name und E-Mail werden mitgeschrieben, damit ein Eintrag auch
          nach dem Löschen eines Kontos noch aussagt, wer was getan hat.
        </p>
        <NativeSelect
          value={action}
          onChange={(event) => {
            setAction(event.target.value as AuditAction | "");
            setOffset(0);
          }}
          aria-label="Nach Ereignis filtern"
          className="w-full sm:w-64"
        >
          <NativeSelectOption value="">Alle Ereignisse</NativeSelectOption>
          {Object.entries(ADMIN_AUDIT_LABEL).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>Noch keine Einträge</EmptyTitle>
            <EmptyDescription>
              Hier erscheint jede Rollenänderung, Sperre, Löschung und Übernahme.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {data.items.map((entry) => {
            const detail = describeAuditMetadata(entry.action, entry.metadata);
            return (
              <li key={entry.id} className="flex flex-wrap items-start gap-3 p-3">
                <Badge
                  variant={entry.action.startsWith("impersonation") ? "secondary" : "outline"}
                  className="mt-0.5 shrink-0"
                >
                  {ADMIN_AUDIT_LABEL[entry.action]}
                </Badge>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <Actor
                      id={entry.actorId}
                      name={entry.actorName}
                      email={entry.actorEmail}
                      fallback="System"
                    />
                    {" → "}
                    <Actor
                      id={entry.targetUserId}
                      name={entry.targetName}
                      email={entry.targetEmail}
                      fallback="gelöschtes Konto"
                    />
                  </p>
                  {detail ? <p className="text-muted-foreground">{detail}</p> : null}
                </div>
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  title={formatDateTime(entry.createdAt)}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {timeAgo(entry.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}

      {data ? (
        <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />
      ) : null}
    </div>
  );
}

/**
 * Links to the account while it exists, and falls back to the snapshotted
 * address once it does not — which is exactly the case a deletion entry covers.
 */
function Actor({
  id,
  name,
  email,
  fallback,
}: {
  id: string | null;
  name: string | null;
  email: string | null;
  fallback: string;
}) {
  const label = name ?? email ?? fallback;
  if (!id) {
    return (
      <span className="font-medium" title={email ?? undefined}>
        {label}
      </span>
    );
  }
  return (
    <Link
      to="/admin/users/$userId"
      params={{ userId: id }}
      className="font-medium hover:underline"
      title={email ?? undefined}
    >
      {label}
    </Link>
  );
}
