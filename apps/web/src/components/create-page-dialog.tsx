import { TemplatePicker, type TemplateChoice } from "@/components/pages/template-picker";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Creates a page as a draft, either blank or from one of the space's templates.
 * When `spaceId` is given the page goes straight into that space; without it
 * (e.g. from the org-level dashboard) the dialog shows a space picker first.
 * Real content enters via this flow — nothing seeded.
 */
export function CreatePageDialog({
  open,
  onOpenChange,
  spaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId?: string | null;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [pickedSpaceId, setPickedSpaceId] = useState("");
  const [templateId, setTemplateId] = useState<TemplateChoice>(null);
  const invalidatePages = useInvalidate(orpc.pages.key());

  const needsPicker = spaceId == null;
  const { data: spaces } = useQuery(
    orpc.spaces.list.queryOptions({ input: {}, enabled: open && needsPicker }),
  );
  // Default the picker to the first space once the list arrives.
  const effectiveSpaceId = spaceId ?? (pickedSpaceId || spaces?.[0]?.id || "");

  // Templates are space-local, so a selection made in one space is meaningless
  // in the next one.
  useEffect(() => setTemplateId(null), [effectiveSpaceId]);

  const onSuccess = (page: { id: string }) => {
    invalidatePages();
    setTitle("");
    setTemplateId(null);
    onOpenChange(false);
    // Straight into the new draft: creating a page is never the goal, writing
    // in it is — and a page created from a template has content to look at.
    navigate({ to: "/pages/$id", params: { id: page.id } });
  };

  const create = useMutation(orpc.pages.create.mutationOptions({ onSuccess, onError: toastError }));
  const createFromTemplate = useMutation(
    orpc.pages.createFromTemplate.mutationOptions({ onSuccess, onError: toastError }),
  );
  const pending = create.isPending || createFromTemplate.isPending;

  const submit = () => {
    const trimmed = title.trim();
    if (!effectiveSpaceId || !trimmed) return;
    if (templateId) {
      createFromTemplate.mutate({ templateId, spaceId: effectiveSpaceId, title: trimmed });
    } else {
      create.mutate({ spaceId: effectiveSpaceId, title: trimmed });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Seite</DialogTitle>
          <DialogDescription>
            {needsPicker
              ? "Die Seite wird als Entwurf im gewählten Space angelegt."
              : "Die Seite wird als Entwurf im Space angelegt."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          {needsPicker && (
            <>
              <NativeSelect
                className="w-full"
                aria-label="Space"
                value={effectiveSpaceId}
                onChange={(e) => setPickedSpaceId(e.target.value)}
                disabled={!spaces?.length}
              >
                {spaces?.map((space) => (
                  <NativeSelectOption key={space.id} value={space.id}>
                    {space.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {spaces && spaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Du hast noch keinen Space. Lege zuerst einen Space an:{" "}
                  <Link
                    to="/spaces"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => onOpenChange(false)}
                  >
                    Zu den Spaces
                  </Link>
                </p>
              ) : null}
            </>
          )}
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Seitentitel"
            aria-label="Seitentitel"
            maxLength={300}
          />
          {effectiveSpaceId ? (
            <TemplatePicker
              spaceId={effectiveSpaceId}
              value={templateId}
              onChange={setTemplateId}
              disabled={pending}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending || !effectiveSpaceId || !title.trim()}>
              {pending ? "Erstellen …" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
