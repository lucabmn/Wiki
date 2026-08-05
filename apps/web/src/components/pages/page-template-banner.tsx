import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Button } from "@nilovon-wiki/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

type TemplatePage = { id: string; spaceId: string; title: string; status: string };

/** Invalidates every list a template's flag can move a page in or out of. */
function useTemplateInvalidation() {
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const invalidateTemplates = useInvalidate(orpc.pages.listTemplates.key());
  const invalidatePage = useInvalidate(orpc.pages.get.key());
  return () => {
    invalidatePages();
    invalidateTemplates();
    invalidatePage();
  };
}

/**
 * Header button that turns a page into a template and back. Marking one removes
 * the page from the tree, search and notifications, which is a big enough change
 * that the toast spells it out rather than leaving the page to silently vanish.
 */
export function TemplateToggleButton({ page }: { page: TemplatePage & { isTemplate: boolean } }) {
  const refresh = useTemplateInvalidation();
  const update = useMutation(
    orpc.pages.update.mutationOptions({
      onSuccess: (updated) => {
        refresh();
        toast.success(
          updated.isTemplate
            ? "Als Vorlage markiert — die Seite erscheint nicht mehr im Seitenbaum."
            : "Vorlagenstatus entfernt — die Seite erscheint wieder im Seitenbaum.",
        );
      },
      onError: toastError,
    }),
  );

  const label = page.isTemplate ? "Vorlagenstatus entfernen" : "Als Vorlage markieren";
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={update.isPending}
      onClick={() => update.mutate({ id: page.id, isTemplate: !page.isTemplate })}
    >
      <LayoutTemplate className={page.isTemplate ? "size-4 text-primary" : "size-4"} />
    </Button>
  );
}

/**
 * Shown at the top of a page that *is* a template: explains why it is missing
 * from the usual places and offers the one action it exists for.
 */
export function PageTemplateBanner({ page }: { page: TemplatePage }) {
  const navigate = useNavigate();
  const invalidatePages = useInvalidate(orpc.pages.list.key());
  const unpublished = page.status !== "published";

  const use = useMutation(
    orpc.pages.createFromTemplate.mutationOptions({
      onSuccess: (created) => {
        invalidatePages();
        toast.success(`„${created.title}" aus der Vorlage erstellt.`);
        navigate({ to: "/pages/$id", params: { id: created.id } });
      },
      onError: toastError,
    }),
  );

  return (
    <Alert className="mt-3">
      <LayoutTemplate />
      <AlertTitle>Vorlage</AlertTitle>
      <AlertDescription>
        Diese Seite ist eine Vorlage. Sie erscheint nicht im Seitenbaum, in der Suche, in Backlinks
        oder in Benachrichtigungen.
        {unpublished ? (
          <>
            {" "}
            <strong className="font-medium text-amber-600">
              Sie ist noch nicht veröffentlicht — daraus erstellte Seiten bleiben leer, bis du sie
              veröffentlichst.
            </strong>
          </>
        ) : null}
      </AlertDescription>
      <div className="col-start-2 mt-2">
        <Button
          size="sm"
          disabled={use.isPending}
          onClick={() => use.mutate({ templateId: page.id, spaceId: page.spaceId })}
        >
          {use.isPending ? "Wird erstellt …" : "Vorlage verwenden"}
        </Button>
      </div>
    </Alert>
  );
}
