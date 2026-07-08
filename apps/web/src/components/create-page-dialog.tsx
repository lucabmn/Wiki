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
import { useState } from "react";

/**
 * Creates a page as a draft. When `spaceId` is given the page goes straight into
 * that space; without it (e.g. from the org-level dashboard) the dialog shows a
 * space picker first. Real content enters via this flow — nothing seeded.
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
  const [title, setTitle] = useState("");
  const [pickedSpaceId, setPickedSpaceId] = useState("");
  const invalidatePages = useInvalidate(orpc.pages.list.key());

  const needsPicker = spaceId == null;
  const { data: spaces } = useQuery(
    orpc.spaces.list.queryOptions({ input: {}, enabled: open && needsPicker }),
  );
  // Default the picker to the first space once the list arrives.
  const effectiveSpaceId = spaceId ?? (pickedSpaceId || spaces?.[0]?.id || "");

  const create = useMutation(
    orpc.pages.create.mutationOptions({
      onSuccess: () => {
        invalidatePages();
        setTitle("");
        onOpenChange(false);
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    const trimmed = title.trim();
    if (effectiveSpaceId && trimmed) {
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
            <NativeSelect
              className="w-full"
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
          )}
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Seitentitel"
            maxLength={300}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={create.isPending || !effectiveSpaceId || !title.trim()}>
              {create.isPending ? "Erstellen …" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
