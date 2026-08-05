import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, Bell, Star } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@nilovon-wiki/ui/components/tooltip";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * A page's lifecycle affordances, split by how often they are used rather than
 * by what they do: the two personal toggles (watch, favorite) stay in the header
 * as icon buttons, while archive and delete are confirmed operations that only
 * appear inside the overflow menu (`page-actions.tsx`). This module therefore
 * exports the toggles as buttons and the destructive pair as *dialogs* — a
 * dropdown item cannot own its own dialog, because the menu unmounts the item
 * the moment it is clicked.
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
  const label = isOn ? labelOn : labelOff;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={isOn}
            disabled={pending}
            onClick={onToggle}
          >
            <Icon className={cn("size-4", isOn && iconOnClass)} />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
 * Bringing an archived page back. Not confirmed and not hidden in a menu —
 * un-archiving is not destructive, and an archived page has exactly one thing
 * its reader wants to do with it.
 */
export function RestoreButton({ page }: { page: { id: string } }) {
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const invalidatePage = useInvalidate(orpc.pages.get.key());

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

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={restore.isPending}
      onClick={() => restore.mutate({ id: page.id })}
    >
      <Archive className="size-4" />
      {restore.isPending ? "Wiederherstellen …" : "Wiederherstellen"}
    </Button>
  );
}

/**
 * Archive confirmation. Controlled from outside so the overflow menu can trigger
 * it: the dialog outlives the menu item that opened it.
 */
export function ArchiveDialog({
  page,
  spaceSlug,
  open,
  onOpenChange,
}: {
  page: { id: string };
  spaceSlug?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());

  const archive = useMutation(
    orpc.pages.archive.mutationOptions({
      onSuccess: () => {
        invalidatePages();
        onOpenChange(false);
        // The page is now hidden — send the reader back to its space (or home).
        if (spaceSlug) navigate({ to: "/spaces/$slug", params: { slug: spaceSlug } });
        else navigate({ to: "/" });
      },
      onError: toastError,
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Seite archivieren?</AlertDialogTitle>
          <AlertDialogDescription>
            Die Seite wird ausgeblendet, bleibt aber auffindbar und vollständig erhalten. Du kannst
            sie jederzeit wiederherstellen.
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
  );
}

/**
 * Move a page to the trash. Distinct from archiving, and the dialog says how:
 * the page disappears from every view but stays restorable until the
 * organization's retention window expires.
 */
export function DeleteDialog({
  page,
  spaceSlug,
  open,
  onOpenChange,
}: {
  page: { id: string; title: string };
  spaceSlug?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const invalidateTrash = useInvalidate(orpc.trash.key());

  const remove = useMutation(
    orpc.pages.delete.mutationOptions({
      onSuccess: (result) => {
        invalidatePages();
        invalidateTrash();
        onOpenChange(false);
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Seite in den Papierkorb?</AlertDialogTitle>
          <AlertDialogDescription>
            „{page.title}" verschwindet mit allen Unterseiten aus allen Ansichten — Suche, Verweise
            und Favoriten inklusive. Bis zum Ablauf der Aufbewahrungsfrist kannst du sie im
            Papierkorb des Bereichs wiederherstellen.
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
  );
}
