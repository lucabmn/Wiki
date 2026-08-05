import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, FileText, Folder, ShieldCheck } from "lucide-react";

import { LegalHoldDialog } from "@/components/lifecycle/legal-hold-dialog";
import { formatDate } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const SUBJECT_ICON = { organization: Building2, space: Folder, page: FileText } as const;
const SUBJECT_LABEL = {
  organization: "Ganze Organisation",
  space: "Bereich",
  page: "Seite",
} as const;

/**
 * Every deletion block in the organization, active ones first.
 *
 * Released blocks stay listed (behind a toggle) on purpose: the record that
 * something *was* protected, by whom, and why it was lifted is the part an
 * auditor asks about. Deleting that history would defeat the feature.
 */
export function LegalHoldTable({ organizationName }: { organizationName: string }) {
  const [showReleased, setShowReleased] = useState(false);
  const [releasing, setReleasing] = useState<{
    id: string;
    reason: string;
    label: string;
    subject: "page" | "space" | "organization";
  } | null>(null);

  const holdsQuery = useQuery(
    orpc.legalHolds.list.queryOptions({ input: { includeReleased: showReleased } }),
  );
  const holds = holdsQuery.data ?? [];
  const active = holds.filter((hold) => !hold.releasedAt);

  if (holdsQuery.isPending) {
    return <Skeleton className="h-24 w-full rounded-lg" />;
  }

  if (holds.length === 0) {
    return (
      <div className="space-y-3">
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheck className="size-6" />
            </EmptyMedia>
            <EmptyTitle>Keine Löschsperren</EmptyTitle>
            <EmptyDescription>
              Sperren setzt du dort, wo das Objekt lebt: am Seiten-Kopf oder in den
              Bereichs-Einstellungen. Sie verhindern jedes Löschen — auch das automatische.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        {!showReleased ? (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowReleased(true)}>
              Aufgehobene Sperren anzeigen
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {holds.map((hold) => {
          const Icon = SUBJECT_ICON[hold.subject];
          const label = hold.subjectLabel ?? organizationName;
          return (
            <li key={hold.id} className="flex items-start gap-3 p-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{label}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {SUBJECT_LABEL[hold.subject]}
                  </Badge>
                  {hold.releasedAt ? (
                    <Badge variant="secondary" className="text-[11px]">
                      aufgehoben
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">{hold.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Gesetzt am {formatDate(hold.createdAt)}
                  {hold.releasedAt
                    ? ` · aufgehoben am ${formatDate(hold.releasedAt)}${
                        hold.releaseReason ? ` — ${hold.releaseReason}` : ""
                      }`
                    : null}
                </p>
              </div>
              {hold.releasedAt ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setReleasing({
                      id: hold.id,
                      reason: hold.reason,
                      label,
                      subject: hold.subject,
                    })
                  }
                >
                  Aufheben
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {active.length} aktive {active.length === 1 ? "Sperre" : "Sperren"}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setShowReleased(!showReleased)}>
          {showReleased ? "Nur aktive anzeigen" : "Aufgehobene Sperren anzeigen"}
        </Button>
      </div>

      {releasing ? (
        <LegalHoldDialog
          open
          onOpenChange={(next) => !next && setReleasing(null)}
          subject={releasing.subject}
          subjectLabel={releasing.label}
          activeHold={{ id: releasing.id, reason: releasing.reason }}
        />
      ) : null}
    </div>
  );
}
