import DashboardLayout from "@/components/layouts/dashboard-layout";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, FileText, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/pages/$id")({
  component: RouteComponent,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function FavoriteButton({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient();
  const { data: favorites } = useQuery(orpc.me.listFavorites.queryOptions({ input: {} }));
  const isFavorite = favorites?.some((favorite) => favorite.id === pageId) ?? false;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.me.listFavorites.key() });
  const onError = (error: Error) => toast.error(error.message);
  const add = useMutation(orpc.me.addFavorite.mutationOptions({ onSuccess: invalidate, onError }));
  const remove = useMutation(
    orpc.me.removeFavorite.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const pending = add.isPending || remove.isPending;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => (isFavorite ? remove : add).mutate({ pageId })}
    >
      <Star className={cn("size-4", isFavorite && "fill-amber-500 text-amber-500")} />
      {isFavorite ? "Favorit" : "Merken"}
    </Button>
  );
}

function CommentCard({ comment }: { comment: { id: string; body: string; createdAt: Date } }) {
  const queryClient = useQueryClient();
  const resolve = useMutation(
    orpc.comments.resolve.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.comments.list.key() }),
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {dateFormat.format(comment.createdAt)}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 h-7"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: comment.id, resolved: true })}
          >
            <Check className="size-3.5" /> Auflösen
          </Button>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
      </CardContent>
    </Card>
  );
}

function CommentForm({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const create = useMutation(
    orpc.comments.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.comments.list.key() });
        setBody("");
      },
      onError: (error) => toast.error(error.message),
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

  return (
    <DashboardLayout className="p-7">
      <div className="mx-auto w-full max-w-3xl">
        {space ? (
          <Link
            to="/spaces/$slug"
            params={{ slug: space.slug }}
            className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {space.name}
          </Link>
        ) : null}

        <div className="mt-3 flex items-start gap-3">
          <span className="mt-1 text-2xl leading-none">
            {page.icon ?? <FileText className="size-6 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{page.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
              <span>Zuletzt geändert {dateFormat.format(page.updatedAt)}</span>
            </div>
          </div>
          <FavoriteButton pageId={page.id} />
        </div>

        <article className="mt-6 text-[15px] leading-7 whitespace-pre-wrap text-foreground/90">
          {page.textContent.trim() ? (
            page.textContent
          ) : (
            <span className="text-muted-foreground">Diese Seite hat noch keinen Inhalt.</span>
          )}
        </article>

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
    </DashboardLayout>
  );
}
