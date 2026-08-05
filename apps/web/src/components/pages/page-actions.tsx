import { useState } from "react";
import {
  Archive,
  History,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import type { HoldStatus } from "@/components/lifecycle/legal-hold-control";
import { LegalHoldDialog } from "@/components/lifecycle/legal-hold-dialog";
import {
  ArchiveDialog,
  DeleteDialog,
  FavoriteButton,
  RestoreButton,
  SubscribeButton,
} from "@/components/pages/page-header-actions";
import { useTemplateToggle } from "@/components/pages/page-template-banner";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";

/**
 * The page header's action rail in read mode.
 *
 * Ordered by how often each affordance is reached for, not by what it does:
 * "Bearbeiten" is the one thing most visitors with write access came to do, the
 * two personal toggles sit next to it as icons, and everything else — access,
 * template, archive, legal hold, delete — lives behind one overflow menu. Eight
 * side-by-side buttons made the header read as a toolbar and pushed the title
 * into a second line; this keeps at most four controls on the row.
 *
 * Every dialog is rendered here rather than inside its menu item: clicking an
 * item closes the menu, which would unmount a dialog owned by the item itself.
 */
export function PageActions({
  page,
  spaceSlug,
  canEdit,
  canManageAccess,
  holdStatus,
  onEdit,
  onOpenAccess,
  onOpenHistory,
}: {
  page: Page;
  spaceSlug?: string;
  canEdit: boolean;
  canManageAccess: boolean;
  holdStatus: HoldStatus | undefined;
  onEdit: () => void;
  onOpenAccess: () => void;
  onOpenHistory: () => void;
}) {
  const [dialog, setDialog] = useState<"archive" | "delete" | "hold" | null>(null);
  const template = useTemplateToggle(page);

  const held = holdStatus?.held === true;
  // A block inherited from the space (or the org) has to be lifted where it was
  // set, so the item says so instead of offering an action that would fail.
  const ownHold = held && holdStatus?.source === "page";
  const inheritedHold = held && holdStatus?.source !== "page";
  const archived = page.archivedAt != null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {canEdit && archived ? <RestoreButton page={page} /> : null}
      {canEdit && !archived ? (
        <Button size="sm" onClick={onEdit}>
          <Pencil className="size-4" /> Bearbeiten
        </Button>
      ) : null}

      <SubscribeButton page={page} />
      <FavoriteButton page={page} />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onOpenHistory}>
            <History className="size-4" /> Versionsverlauf
          </DropdownMenuItem>
          {canManageAccess ? (
            <DropdownMenuItem onClick={onOpenAccess}>
              <Lock className="size-4" /> Zugriff verwalten
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem disabled={template.pending} onClick={template.toggle}>
              <LayoutTemplate className="size-4" /> {template.label}
            </DropdownMenuItem>
          ) : null}

          {canEdit || canManageAccess ? <DropdownMenuSeparator /> : null}

          {canEdit && !archived ? (
            <DropdownMenuItem onClick={() => setDialog("archive")}>
              <Archive className="size-4" /> Archivieren
            </DropdownMenuItem>
          ) : null}
          {canManageAccess ? (
            <DropdownMenuItem
              disabled={inheritedHold}
              onClick={() => setDialog("hold")}
              title={
                inheritedHold
                  ? "Die Sperre muss dort aufgehoben werden, wo sie gesetzt wurde."
                  : undefined
              }
            >
              <ShieldCheck className="size-4" /> {ownHold ? "Sperre aufheben" : "Löschsperre"}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem
              variant="destructive"
              // Refused server-side anyway; disabled here so the reason (in the
              // badge next to the heading) arrives before the click.
              disabled={held}
              onClick={() => setDialog("delete")}
            >
              <Trash2 className="size-4" /> Löschen
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ArchiveDialog
        page={page}
        spaceSlug={spaceSlug}
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
      />
      <DeleteDialog
        page={page}
        spaceSlug={spaceSlug}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      />
      {canManageAccess ? (
        <LegalHoldDialog
          open={dialog === "hold"}
          onOpenChange={(open) => setDialog(open ? "hold" : null)}
          subject="page"
          subjectId={page.id}
          subjectLabel={page.title}
          activeHold={
            ownHold && holdStatus?.holdId
              ? { id: holdStatus.holdId, reason: holdStatus.reason }
              : null
          }
        />
      ) : null}
    </div>
  );
}
