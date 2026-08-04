import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Bell, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { toastError, useInvalidate, useOptimisticListToggle } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nilovon-wiki/ui/components/alert-dialog";
import { Button } from "@nilovon-wiki/ui/components/button";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * The controls in a page's header: watch, favorite, archive and delete.
 *
 * Extracted from the route so the four lifecycle affordances sit together — they
 * are easy to confuse, and the distinction between "archive" and "delete" only
 * reads clearly when the two are written next to each other.
 */

function PageToggleButton({
  isOn,
  pending,
  onToggle,
  labelOn,
  labelOff,
  icon: Icon,
  iconOnClass,
}: {
  isOn: boolean;
  pending: boolean;
  onToggle: () => void;
  labelOn: string;
  labelOff: string;
  icon: typeof Star;
  iconOnClass: string;
}) {
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={onToggle}>
      <Icon className={cn("size-4", isOn && iconOnClass)} />
      {isOn ? labelOn : labelOff}
    </Button>
  );
}

export function FavoriteButton({ page }: { page: Page }) {
  const listOptions = orpc.me.listFavorites.queryOptions({ input: {} });
  const { data: favorites } = useQuery(listOptions);
  const isFavorite = favorites?.some((favorite) => favorite.id === page.id) ?? false;

  const optimistic = useOptimisticListToggle<Page>(
    listOptions.queryKey,
    orpc.me.listFavorites.key(),
  );
  const add = useMutation(orpc.me.addFavorite.mutationOptions(optimistic(page, true)));
  const remove = useMutation(orpc.me.removeFavorite.mutationOptions(optimistic(page, false)));

  return (
    <PageToggleButton
      isOn={isFavorite}
      pending={add.isPending || remove.isPending}
      onToggle={() => (isFavorite ? remove : add).mutate({ pageId: page.id })}
      labelOn="Favorit"
      labelOff="Merken"
      icon={Star}
      iconOnClass="fill-amber-500 text-amber-500"
    />
  );
}

export function SubscribeButton({ page }: { page: Page }) {
  const listOptions = orpc.me.listSubscriptions.queryOptions({ input: {} });
  const { data: subscriptions } = useQuery(listOptions);
  const isSubscribed = subscriptions?.some((subscription) => subscription.id === page.id) ?? false;

  const optimistic = useOptimisticListToggle<Page>(
    listOptions.queryKey,
    orpc.me.listSubscriptions.key(),
  );
  const subscribe = useMutation(orpc.me.subscribe.mutationOptions(optimistic(page, true)));
  const unsubscribe = useMutation(orpc.me.unsubscribe.mutationOptions(optimistic(page, false)));

  return (
    <PageToggleButton
      isOn={isSubscribed}
      pending={subscribe.isPending || unsubscribe.isPending}
      onToggle={() => (isSubscribed ? unsubscribe : subscribe).mutate({ pageId: page.id })}
      labelOn="Abonniert"
      labelOff="Abonnieren"
      icon={Bell}
      iconOnClass="fill-current"
    />
  );
}

/**
 * Archive, or un-archive. Two labels on one control because they are one
 * decision: "is this page still current?" Restoring is not confirmed — bringing
 * something back is not a destructive act.
 */
export function ArchiveButton({
  page,
  spaceSlug,
}: {
  page: { id: string; archivedAt: Date | null };
  spaceSlug?: string;
}) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const invalidatePage = useInvalidate(orpc.pages.get.key());
  const [open, setOpen] = useState(false);

  const archive = useMutation(
    orpc.pages.archive.mutationOptions({
      onSuccess: () => {
        invalidatePages();
        setOpen(false);
        // The page is now hidden — send the reader back to its space (or home).
        if (spaceSlug) navigate({ to: "/spaces/$slug", params: { slug: spaceSlug } });
        else navigate({ to: "/" });
      },
      onError: toastError,
    }),
  );

  const restore = useMutation(
    orpc.pages.restore.mutationOptions({
      onSuccess: () => {
        invalidatePages();
        invalidatePage();
        toast.success("Seite wiederhergestellt");
      },
      onError: toastError,
    }),
  );

  if (page.archivedAt) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={restore.isPending}
        onClick={() => restore.mutate({ id: page.id })}
      >
        <ArchiveRestore className="size-4" />
        {restore.isPending ? "Wiederherstellen …" : "Wiederherstellen"}
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Archive className="size-4" /> Archivieren
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seite archivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Seite wird ausgeblendet, bleibt aber auffindbar und vollständig erhalten. Du
              kannst sie jederzeit wiederherstellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                archive.mutate({ id: page.id });
              }}
            >
              {archive.isPending ? "Archivieren …" : "Archivieren"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Move a page to the trash. Distinct from archiving, and the dialog says how:
 * the page disappears from every view but stays restorable until the
 * organization's retention window expires.
 */
export function DeleteButton({
  page,
  spaceSlug,
  held,
}: {
  page: { id: string; title: string };
  spaceSlug?: string;
  held: boolean;
}) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const invalidateTrash = useInvalidate(orpc.trash.key());
  const [open, setOpen] = useState(false);

  const remove = useMutation(
    orpc.pages.delete.mutationOptions({
      onSuccess: (result) => {
        invalidatePages();
        invalidateTrash();
        setOpen(false);
        toast.success(
          result.deleted > 1
            ? `Seite mit ${result.deleted - 1} Unterseiten in den Papierkorb verschoben`
            : "Seite in den Papierkorb verschoben",
        );
        if (spaceSlug) navigate({ to: "/spaces/$slug", params: { slug: spaceSlug } });
        else navigate({ to: "/" });
      },
      onError: toastError,
    }),
  );

  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Löschen"
        // Refused server-side anyway; disabled here so the reason (in the title,
        // and in the badge next to the heading) arrives before the click.
        disabled={held}
        title={held ? "Löschsperre: diese Seite kann nicht gelöscht werden" : "Löschen"}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seite in den Papierkorb?</AlertDialogTitle>
            <AlertDialogDescription>
              „{page.title}" verschwindet mit allen Unterseiten aus allen Ansichten — Suche,
              Verweise und Favoriten inklusive. Bis zum Ablauf der Aufbewahrungsfrist kannst du sie
              im Papierkorb des Bereichs wiederherstellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate({ id: page.id });
              }}
            >
              {remove.isPending ? "Verschieben …" : "In den Papierkorb"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
