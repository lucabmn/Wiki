import DashboardLayout from "@/components/layouts/dashboard-layout";
import { PageAside } from "@/components/editor/page-aside";
import { PageContent } from "@/components/editor/page-content";
import { PageEditor } from "@/components/editor/page-editor";
import { extractHeadings } from "@/components/editor/headings";
import { STATUS_LABEL } from "@/lib/labels";
import { usePermission } from "@/lib/permissions";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
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
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Archive, Bell, Check, FileText, Pencil, Star, Trash2 } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_auth/pages/$id")({
  component: RouteComponent,
});

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Outline button that flips a per-page flag (favorite, subscription, …). */
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

function FavoriteButton({ pageId }: { pageId: string }) {
  const { data: favorites } = useQuery(orpc.me.listFavorites.queryOptions({ input: {} }));
  const isFavorite = favorites?.some((favorite) => favorite.id === pageId) ?? false;

  const invalidate = useInvalidate(orpc.me.listFavorites.key());
  const add = useMutation(
    orpc.me.addFavorite.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );
  const remove = useMutation(
    orpc.me.removeFavorite.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );

  return (
    <PageToggleButton
      isOn={isFavorite}
      pending={add.isPending || remove.isPending}
      onToggle={() => (isFavorite ? remove : add).mutate({ pageId })}
      labelOn="Favorit"
      labelOff="Merken"
      icon={Star}
      iconOnClass="fill-amber-500 text-amber-500"
    />
  );
}

function SubscribeButton({ pageId }: { pageId: string }) {
  const { data: subscriptions } = useQuery(orpc.me.listSubscriptions.queryOptions({ input: {} }));
  const isSubscribed = subscriptions?.some((subscription) => subscription.id === pageId) ?? false;

  const invalidate = useInvalidate(orpc.me.listSubscriptions.key());
  const subscribe = useMutation(
    orpc.me.subscribe.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );
  const unsubscribe = useMutation(
    orpc.me.unsubscribe.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );

  return (
    <PageToggleButton
      isOn={isSubscribed}
      pending={subscribe.isPending || unsubscribe.isPending}
      onToggle={() => (isSubscribed ? unsubscribe : subscribe).mutate({ pageId })}
      labelOn="Abonniert"
      labelOff="Abonnieren"
      icon={Bell}
      iconOnClass="fill-current"
    />
  );
}

function ArchiveButton({ pageId, spaceSlug }: { pageId: string; spaceSlug?: string }) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());
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
              Die Seite wird ausgeblendet. Du kannst sie später wiederherstellen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                archive.mutate({ id: pageId });
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

function CommentCard({ comment }: { comment: { id: string; body: string; createdAt: Date } }) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const resolve = useMutation(
    orpc.comments.resolve.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );
  const remove = useMutation(
    orpc.comments.delete.mutationOptions({ onSuccess: invalidate, onError: toastError }),
  );

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {dateFormat.format(comment.createdAt)}
          </div>
          <div className="-my-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: comment.id, resolved: true })}
            >
              <Check className="size-3.5" /> Auflösen
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              disabled={remove.isPending}
              aria-label="Kommentar löschen"
              onClick={() => remove.mutate({ id: comment.id })}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
      </CardContent>
    </Card>
  );
}

function CommentForm({ pageId }: { pageId: string }) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const [body, setBody] = useState("");

  const create = useMutation(
    orpc.comments.create.mutationOptions({
      onSuccess: () => {
        invalidate();
        setBody("");
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed) create.mutate({ pageId, body: trimmed });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-3 space-y-2"
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Kommentar schreiben …"
        rows={3}
        maxLength={10_000}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending || !body.trim()}>
          {create.isPending ? "Senden …" : "Kommentieren"}
        </Button>
      </div>
    </form>
  );
}

function RouteComponent() {
  const { id } = Route.useParams();
  const [editing, setEditing] = useState(false);
  const canEdit = usePermission({ page: ["update"] });

  // Resolve author/editor ids to names via the org's member list.
  const { auth } = useRouteContext({ from: "/_auth" });
  const nameOf = (userId: string | null) => {
    if (!userId) return "—";
    return (
      auth.organization.members.find((member) => member.user.id === userId)?.user.name ??
      "Unbekannt"
    );
  };

  const {
    data: page,
    isPending,
    isError,
  } = useQuery(orpc.pages.get.queryOptions({ input: { id } }));
  const { data: comments } = useQuery(
    orpc.comments.list.queryOptions({ input: { pageId: id }, enabled: Boolean(page) }),
  );
  // Resolve the owning space for the back-link; cached from the sidebar.
  const { data: spaces } = useQuery(orpc.spaces.list.queryOptions({ input: {} }));
  const space = spaces?.find((s) => s.id === page?.spaceId);

  if (isPending) {
    return (
      <DashboardLayout className="p-7">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-48 w-full" />
      </DashboardLayout>
    );
  }

  if (isError || !page) {
    return (
      <DashboardLayout className="p-7">
        <h1 className="text-lg font-semibold">Seite nicht gefunden</h1>
        <p className="text-sm text-muted-foreground">
          Diese Seite existiert nicht oder du hast keinen Zugriff.
        </p>
      </DashboardLayout>
    );
  }

  const openComments = comments?.filter((c) => !c.resolvedAt && !c.deletedAt) ?? [];

  const backLink =
    space != null ? (
      <Link
        to="/spaces/$slug"
        params={{ slug: space.slug }}
        className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {space.name}
      </Link>
    ) : null;

  if (editing) {
    return (
      <DashboardLayout className="p-7">
        <div className="mx-auto w-full max-w-4xl">
          {backLink}
          <div className="mt-3">
            <PageEditor page={page} onDone={() => setEditing(false)} />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const headings = extractHeadings(page.content);

  return (
    <DashboardLayout className="p-7">
      <div className="mx-auto flex w-full max-w-6xl gap-10">
        <div className="min-w-0 flex-1">
          {backLink}

          <div className="mt-3 flex items-start gap-3">
            <span className="mt-1 text-2xl leading-none">
              {page.icon ?? <FileText className="size-6 text-muted-foreground" />}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                {page.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
                <span>Zuletzt geändert {dateFormat.format(page.updatedAt)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canEdit ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Bearbeiten
                </Button>
              ) : null}
              <SubscribeButton pageId={page.id} />
              <FavoriteButton pageId={page.id} />
              <ArchiveButton pageId={page.id} spaceSlug={space?.slug} />
            </div>
          </div>

          <div className="mt-6">
            <PageContent content={page.content} fallbackText={page.textContent} />
          </div>

          <section className="mt-10">
            <h2 className="mb-3 text-[15px] font-semibold">
              Kommentare{openComments.length ? ` (${openComments.length})` : ""}
            </h2>
            {!openComments.length ? (
              <p className="text-sm text-muted-foreground">Noch keine Kommentare.</p>
            ) : (
              <div className="space-y-2">
                {openComments.map((comment) => (
                  <CommentCard key={comment.id} comment={comment} />
                ))}
              </div>
            )}
            <CommentForm pageId={page.id} />
          </section>
        </div>

        <aside className="hidden w-60 shrink-0 xl:block">
          <div className="sticky top-6">
            <PageAside page={page} headings={headings} nameOf={nameOf} />
          </div>
        </aside>
      </div>
    </DashboardLayout>
  );
}
