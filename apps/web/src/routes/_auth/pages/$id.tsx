import DashboardLayout from "@/components/layouts/dashboard-layout";
import { PageAside } from "@/components/editor/page-aside";
import { PageContent } from "@/components/editor/page-content";
import { PageEditor } from "@/components/editor/page-editor";
import { PageAccessSheet } from "@/components/pages/page-access-sheet";
import { RevisionHistory } from "@/components/editor/revision-history";
import { extractHeadings } from "@/components/editor/headings";
import { STATUS_LABEL } from "@/lib/labels";
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
import { Archive, Bell, Check, FileText, Lock, Pencil, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const resolve = useMutation(
    orpc.comments.resolve.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Kommentar aufgelöst");
      },
      onError: toastError,
    }),
  );
  const remove = useMutation(
    orpc.comments.delete.mutationOptions({
      onSuccess: () => {
        invalidate();
        setConfirmDelete(false);
        toast.success("Kommentar gelöscht");
      },
      onError: toastError,
    }),
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
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kommentar löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Kommentar wird dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate({ id: comment.id });
              }}
            >
              {remove.isPending ? "Löschen …" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        toast.success("Kommentar hinzugefügt");
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
  const [historyOpen, setHistoryOpen] = useState(false);
  // Effective page-level access (respects space + per-page ACL), replacing the
  // old org-level permission check so the UI matches server enforcement.
  const { data: access } = useQuery(orpc.pageAccess.myRole.queryOptions({ input: { pageId: id } }));
  const canEdit = access?.canWrite ?? false;
  const canManageAccess = access?.canManage ?? false;
  const [accessOpen, setAccessOpen] = useState(false);

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
        <div className="mt-4">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/" />}>
            Zur Übersicht
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const openComments = comments?.filter((c) => !c.resolvedAt && !c.deletedAt) ?? [];

  // Neutral fallback while the space list is still loading, so the reader
  // always has an in-content way back.
  const backLink =
    space != null ? (
      <Link
        to="/spaces/$slug"
        params={{ slug: space.slug }}
        className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← {space.name}
      </Link>
    ) : (
      <Link
        to="/"
        className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Übersicht
      </Link>
    );

  if (editing) {
    return (
      <DashboardLayout className="p-7">
        <div className="mx-auto w-full max-w-4xl">
          {backLink}
          <div className="mt-3">
            <PageEditor page={page} canPublish={canEdit} onDone={() => setEditing(false)} />
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
              {canManageAccess ? (
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Zugriff"
                  title="Zugriff"
                  onClick={() => setAccessOpen(true)}
                >
                  <Lock className="size-4" />
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Bearbeiten"
                  title="Bearbeiten"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-4" />
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

          <section id="page-comments" className="mt-10 scroll-mt-6">
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
            <PageAside
              page={page}
              headings={headings}
              nameOf={nameOf}
              commentCount={openComments.length}
              onOpenHistory={() => setHistoryOpen(true)}
              onJumpToComments={() =>
                document
                  .getElementById("page-comments")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          </div>
        </aside>
      </div>

      <RevisionHistory
        pageId={page.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore={canEdit}
      />
      {canManageAccess ? (
        <PageAccessSheet
          open={accessOpen}
          onOpenChange={setAccessOpen}
          pageId={page.id}
          pageTitle={page.title}
          organizationId={auth.organization.id}
        />
      ) : null}
    </DashboardLayout>
  );
}
