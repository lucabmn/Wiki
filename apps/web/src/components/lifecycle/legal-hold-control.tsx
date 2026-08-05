import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import { LegalHoldDialog } from "@/components/lifecycle/legal-hold-dialog";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nilovon-wiki/ui/components/tooltip";

/**
 * Whether one object is blocked from deletion, shown where the user would
 * otherwise be baffled: next to a "Delete" button that refuses.
 *
 * The badge is not decoration. Without it a blocked page reads as a bug — the
 * button is there, the click fails, and nothing on screen explains why. It is
 * therefore rendered for *everyone* who can see the object; only the control that
 * changes the block is gated on being able to manage the organization.
 */

export type HoldStatus = {
  held: boolean;
  source: "none" | "page" | "space" | "organization";
  reason: string | null;
  holdId: string | null;
};

const SOURCE_TEXT: Record<HoldStatus["source"], string> = {
  none: "",
  page: "Diese Seite ist gegen Löschen gesperrt.",
  space: "Der Bereich dieser Seite ist gegen Löschen gesperrt.",
  organization: "Die gesamte Organisation ist gegen Löschen gesperrt.",
};

/** Reads the effective block for a page or a space. Pass exactly one id. */
export function useHoldStatus(target: { pageId?: string; spaceId?: string }) {
  return useQuery(
    orpc.legalHolds.status.queryOptions({
      input: target.pageId ? { pageId: target.pageId } : { spaceId: target.spaceId! },
      enabled: Boolean(target.pageId ?? target.spaceId),
    }),
  );
}

/**
 * The org-wide block, derived from the hold list rather than `status` — that
 * endpoint answers "is this object blocked?" and needs an object. Admin-only,
 * like the list it reads.
 */
export function useOrganizationHoldStatus(): HoldStatus | undefined {
  const query = useQuery(orpc.legalHolds.list.queryOptions({ input: { includeReleased: false } }));
  if (!query.data) return undefined;
  const hold = query.data.find((row) => row.subject === "organization");
  return hold
    ? { held: true, source: "organization", reason: hold.reason, holdId: hold.id }
    : { held: false, source: "none", reason: null, holdId: null };
}

/** The read-only marker. Renders nothing when the object is free. */
export function LegalHoldBadge({ status }: { status: HoldStatus | undefined }) {
  if (!status?.held) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700">
            <ShieldCheck className="size-3" />
            Löschsperre
          </Badge>
        }
      />
      <TooltipContent className="max-w-64">
        <p>{SOURCE_TEXT[status.source]}</p>
        {status.reason ? <p className="mt-1 opacity-80">{status.reason}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Set or lift the block on one object. Only offered where it can actually be
 * changed: a block inherited from the space (or the org) has to be lifted where
 * it was set, so the button says so instead of failing.
 */
export function LegalHoldControl({
  subject,
  subjectId,
  subjectLabel,
  status,
  variant = "outline",
}: {
  subject: "page" | "space" | "organization";
  subjectId?: string;
  subjectLabel: string;
  status: HoldStatus | undefined;
  variant?: "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  if (!status) return null;

  const ownHold = status.held && status.source === subject;
  const inherited = status.held && status.source !== subject;

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        // An inherited block cannot be lifted from here, and setting a second
        // one on top would be theatre — the object is already protected.
        disabled={inherited}
        title={
          inherited
            ? `${SOURCE_TEXT[status.source]} Die Sperre muss dort aufgehoben werden, wo sie gesetzt wurde.`
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="size-4" />
        {ownHold ? "Sperre aufheben" : "Löschsperre"}
      </Button>
      <LegalHoldDialog
        open={open}
        onOpenChange={setOpen}
        subject={subject}
        subjectId={subjectId}
        subjectLabel={subjectLabel}
        activeHold={ownHold && status.holdId ? { id: status.holdId, reason: status.reason } : null}
      />
    </>
  );
}
