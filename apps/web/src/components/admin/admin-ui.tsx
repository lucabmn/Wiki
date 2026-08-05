import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/** Small building blocks shared by the admin pages, so their rhythm matches. */

export function StatCard({
  label,
  value,
  hint,
  isPending,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  isPending?: boolean;
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      {isPending ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      )}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

/** A configured/unconfigured dependency, stated plainly rather than colour-coded only. */
export function HealthRow({
  label,
  ok,
  okText,
  failText,
  detail,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail ? (
          <div className="truncate text-xs text-muted-foreground" title={String(detail)}>
            {detail}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium",
          ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {ok ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
        {ok ? okText : failText}
      </span>
    </div>
  );
}

export function LabelValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * Offset pagination with a spoken position ("26–50 von 312").
 *
 * Page numbers alone are useless when the list is filtered from a search box;
 * the range tells you whether the filter narrowed anything.
 */
export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {from}–{to} von {total}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="size-4" aria-hidden />
          Zurück
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
        >
          Weiter
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Instance role, shown as a badge so "admin" is never mistaken for an org role. */
export function InstanceRoleBadge({ roles }: { roles: string[] }) {
  const isAdmin = roles.includes("admin");
  return (
    <Badge variant={isAdmin ? "secondary" : "outline"}>
      {isAdmin ? "Instanz-Admin" : "Benutzer"}
    </Badge>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

/** Bytes in the unit a human would say them in. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1).replace(".", ",")} ${units[exponent]}`;
}
