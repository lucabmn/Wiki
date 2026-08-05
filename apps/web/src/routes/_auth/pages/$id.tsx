import type { Editor } from "@tiptap/core";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useLocation, useRouteContext } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { InlineComments } from "@/components/comments/inline-comments";
import { extractHeadings } from "@/components/editor/headings";
import { PageAside } from "@/components/editor/page-aside";
import { PageContent } from "@/components/editor/page-content";
import { PageEditor } from "@/components/editor/page-editor";
import { RevisionHistory } from "@/components/editor/revision-history";
import { LegalHoldBadge, useHoldStatus } from "@/components/lifecycle/legal-hold-control";
import { PageAccessSheet } from "@/components/pages/page-access-sheet";
import { PageActions } from "@/components/pages/page-actions";
import { PageBreadcrumb } from "@/components/pages/page-breadcrumb";
import { PageAttachments } from "@/components/pages/page-attachments";
import { CommentCard, CommentForm } from "@/components/pages/page-comments";
import { PageExternalLinks } from "@/components/pages/page-external-links";
import { PageTags } from "@/components/pages/page-tags";
import { PageTemplateBanner } from "@/components/pages/page-template-banner";
import { splitComments } from "@/lib/inline-comments";
import { STATUS_LABEL } from "@/lib/labels";
import { scrollIntoPageView } from "@/lib/scroll";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/pages/$id")({
  component: RouteComponent,
});

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function RouteComponent() {
  const { id } = Route.useParams();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Effective page-level access (respects space + per-page ACL), replacing the
  // old org-level permission check so the UI matches server enforcement.
  const { data: access } = useQuery(orpc.pageAccess.myRole.queryOptions({ input: { pageId: id } }));
  const canEdit = access?.canWrite ?? false;
  const canComment = access?.canComment ?? false;
  const canManageAccess = access?.canManage ?? false;
  // The document, editable or read-only: the inline-comment layer measures the
  // rendered anchors inside it instead of reaching into the editor state, so
  // one path serves both modes.
  const contentRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Read by everyone who can open the page: without the badge, a blocked page
  // reads as a broken "Delete" button rather than a deliberate protection.
  const holdStatus = useHoldStatus({ pageId: id });
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
  const pageComments = useMemo(() => splitComments(comments ?? []).page, [comments]);
  // A notification links straight at one comment. The anchor only exists once
  // the list has rendered, so the jump waits for the query rather than the URL.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash.startsWith("comment-") || !comments) return;
    const target = document.getElementById(hash);
    if (target) scrollIntoPageView(target);
  }, [hash, comments]);

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

  // Anchored comments live in the margin rail; only page-wide ones (and their
  // replies) belong in the section under the document. Both kinds coexist.
  const openComments = pageComments.filter((c) => !c.resolvedAt && !c.deletedAt);

  // Space › Elternseiten › Titel; falls die Space-Liste noch lädt, führt der
  // erste Eintrag neutral zur Übersicht.
  const breadcrumb = <PageBreadcrumb page={page} space={space} />;

  // TOC derives from the published body only — also while editing, where the
  // rail keeps showing the last published outline instead of disappearing.
  const headings = extractHeadings(page.status === "published" ? page.content : null);

  const tagRow = <PageTags pageId={page.id} spaceId={page.spaceId} canEdit={canEdit} />;

  return (
    <DashboardLayout className="p-7">
      {/* One shell for both modes — same width, same right rail, same sections
          below — so editing swaps header actions and body in place instead of
          re-flowing the page into a narrower column. The document keeps the
          whole content column: inline comments live in the rail below the page
          metadata rather than in a third column that squeezed the editor. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-10 gap-y-8">
        <div className="min-w-0 flex-1">
          {page.isTemplate ? <PageTemplateBanner page={page} /> : null}

          <div ref={contentRef}>
            {editing ? (
              <PageEditor
                page={page}
                canPublish={canEdit}
                onDone={() => setEditing(false)}
                breadcrumb={breadcrumb}
                belowHeader={tagRow}
                historyOpen={historyOpen}
                onHistoryOpenChange={setHistoryOpen}
                onEditor={setEditor}
              />
            ) : (
              <>
                {/* Trail and actions share the top row so the title below can
                    use the full column — with eight buttons beside it, a normal
                    title wrapped onto a second line. */}
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">{breadcrumb}</div>
                  <PageActions
                    page={page}
                    spaceSlug={space?.slug}
                    canEdit={canEdit}
                    canManageAccess={canManageAccess}
                    holdStatus={holdStatus.data}
                    onEdit={() => setEditing(true)}
                    onOpenAccess={() => setAccessOpen(true)}
                    onOpenHistory={() => setHistoryOpen(true)}
                  />
                </div>

                <div className="mt-4 flex items-start gap-3">
                  <span className="mt-1 text-2xl leading-none">
                    {page.icon ?? <FileText className="size-6 text-muted-foreground" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                      {page.title}
                    </h1>
                    {/* Status, block, timestamp and tags on one wrapping line
                        instead of three stacked rows above the body. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
                      <LegalHoldBadge status={holdStatus.data} />
                      <span>Zuletzt geändert {dateFormat.format(page.updatedAt)}</span>
                      {tagRow}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {/* Readers see the published projection only: an unpublished page
                    (or draft with leftover content) never renders its body. */}
                  <PageContent
                    content={page.status === "published" ? page.content : null}
                    fallbackText={page.status === "published" ? page.textContent : ""}
                    emptyLabel={
                      page.status === "published"
                        ? "Diese Seite hat noch keinen Inhalt."
                        : "Diese Seite wurde noch nicht veröffentlicht."
                    }
                  />
                </div>
              </>
            )}
          </div>

          <div className="mt-10">
            <PageExternalLinks pageId={page.id} canEdit={canEdit} />
          </div>

          <div className="mt-10">
            <PageAttachments pageId={page.id} spaceId={page.spaceId} canEdit={canEdit} />
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
            <CommentForm pageId={page.id} spaceId={page.spaceId} />
          </section>
        </div>

        {/* One rail, not two: outline, actions and metadata first, inline
            comments stacked underneath. Splitting them into separate columns
            left the document — and especially the editor — with barely half the
            width on exactly the screens that had room to spare. */}
        <aside className="w-full shrink-0 xl:w-72">
          <div className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
            {/* Outline and metadata only earn a column where there is one; below
                `xl` the rail carries the inline comments alone. */}
            <div className="hidden xl:block">
              <PageAside
                page={page}
                headings={headings}
                nameOf={nameOf}
                commentCount={openComments.length}
                onOpenHistory={() => setHistoryOpen(true)}
                onJumpToComments={() => {
                  const comments = document.getElementById("page-comments");
                  if (comments) scrollIntoPageView(comments);
                }}
              />
            </div>
            {/* `InlineComments` renders nothing when the page has no anchored
                comments and none can be written — `empty:hidden` then takes the
                divider with it instead of leaving a rule under the metadata. */}
            <div className="border-t pt-4 empty:hidden">
              <InlineComments
                pageId={page.id}
                spaceId={page.spaceId}
                contentRef={contentRef}
                editor={editing ? editor : null}
                canComment={canComment}
                canModerate={canEdit}
                viewerId={auth.session.user.id}
                nameOf={nameOf}
                anchored={false}
              />
            </div>
          </div>
        </aside>
      </div>

      {/* While editing, the editor owns the history sheet: a restore has to go
          into the live Yjs document, not through a server-side content write. */}
      {editing ? null : (
        <RevisionHistory
          pageId={page.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEdit}
        />
      )}
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
