import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

/**
 * Template management for a space: what the catalogue currently offers, and the
 * one destructive-ish action on it — releasing a page back into the page tree.
 * Creating a template happens on the page itself (its header has the toggle),
 * because a template is just a page someone decided to reuse.
 */
export function SpaceTemplates({
  spaceId,
  enabled,
  onNavigate,
}: {
  spaceId: string;
  enabled: boolean;
  /** Lets the caller close its sheet before the route changes. */
  onNavigate: () => void;
}) {
  const invalidateTemplates = useInvalidate(orpc.pages.listTemplates.key());
  const invalidatePages = useInvalidate(orpc.pages.key());

  const { data: templates, isPending } = useQuery(
    orpc.pages.listTemplates.queryOptions({ input: { spaceId }, enabled }),
  );

  const release = useMutation(
    orpc.pages.update.mutationOptions({
      onSuccess: (page) => {
        invalidateTemplates();
        invalidatePages();
        toast.success(`„${page.title}" ist wieder eine normale Seite.`);
      },
      onError: toastError,
    }),
  );

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">Vorlagen</h3>
        <p className="text-xs text-muted-foreground">
          Startpunkte für wiederkehrende Seiten. Sie erscheinen beim Anlegen einer Seite, aber nicht
          im Seitenbaum, in der Suche oder in Benachrichtigungen.
        </p>
      </div>

      {isPending ? (
        <div className="grid gap-1.5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : !templates?.length ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Noch keine Vorlagen. Öffne eine Seite, die sich wiederholt — etwa eine Meeting-Notiz — und
          markiere sie in der Kopfzeile als Vorlage.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border">
          {templates.map((template) => (
            <li key={template.id} className="flex items-start gap-3 p-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-sm leading-none text-muted-foreground">
                {template.icon ?? <LayoutTemplate className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to="/pages/$id"
                  params={{ id: template.id }}
                  onClick={onNavigate}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {template.title || "Ohne Titel"}
                </Link>
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {template.excerpt || "Diese Vorlage hat noch keinen Inhalt."}
                </p>
                {template.hasContent ? null : (
                  <p className="mt-0.5 text-xs text-amber-600">
                    Noch nicht veröffentlicht — daraus erstellte Seiten bleiben leer.
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={release.isPending}
                onClick={() => release.mutate({ id: template.id, isTemplate: false })}
              >
                Freigeben
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
