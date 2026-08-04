import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";

import { orpc } from "@/utils/orpc";
import { ACTION_LABEL } from "@/lib/labels";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" });

/**
 * The delivery log of one webhook.
 *
 * Without this the feature is not debuggable: "nothing arrives" has half a dozen
 * causes (wrong URL, receiver 500s, event not subscribed, webhook paused) and
 * only the response status and the error text tell them apart. Hence the status
 * code and the raw error are shown verbatim rather than summarised.
 */
export function WebhookDeliveriesSheet({
  webhookId,
  webhookName,
  onOpenChange,
}: {
  /** Null closes the sheet. */
  webhookId: string | null;
  webhookName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery(
    orpc.webhooks.listDeliveries.queryOptions({
      input: { webhookId: webhookId ?? "", limit: 25 },
      enabled: webhookId !== null,
      // A pending delivery settles within seconds — a stale log would have the
      // admin reaching for the reload button.
      refetchInterval: 10_000,
    }),
  );
  const deliveries = query.data ?? [];

  return (
    <Sheet open={webhookId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Zustellungen</SheetTitle>
          <SheetDescription>Die letzten 25 Versuche an „{webhookName}".</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {query.isPending ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          ) : deliveries.length === 0 ? (
            <Empty className="rounded-xl border border-dashed border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Clock />
                </EmptyMedia>
                <EmptyTitle>Noch nichts zugestellt</EmptyTitle>
                <EmptyDescription>
                  Sobald eines der abonnierten Ereignisse eintritt, steht der Versuch hier — auch
                  wenn er fehlschlägt.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            deliveries.map((delivery) => (
              <div key={delivery.id} className="space-y-1.5 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {delivery.event ? (ACTION_LABEL[delivery.event] ?? delivery.event) : "Testping"}
                  </span>
                  <StatusBadge
                    status={delivery.status}
                    responseStatus={delivery.responseStatus}
                    attempts={delivery.attempts}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateFormat.format(delivery.createdAt)}
                  {delivery.attempts > 1 ? ` · ${delivery.attempts} Versuche` : null}
                  {delivery.status === "pending" && delivery.nextAttemptAt
                    ? ` · nächster Versuch ${dateFormat.format(delivery.nextAttemptAt)}`
                    : null}
                </div>
                {delivery.lastError ? (
                  <p className="rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
                    {delivery.lastError}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border p-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className="size-4" /> Aktualisieren
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function StatusBadge({
  status,
  responseStatus,
  attempts,
}: {
  status: "pending" | "delivered" | "failed";
  responseStatus: number | null;
  attempts?: number;
}) {
  if (status === "delivered") {
    return (
      <Badge variant="secondary">
        <CheckCircle2 className="size-3" /> {responseStatus ?? "OK"}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        <XCircle className="size-3" /> {responseStatus ?? "Fehler"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Clock className="size-3" /> {attempts && attempts > 0 ? "Wiederholung" : "Ausstehend"}
    </Badge>
  );
}
