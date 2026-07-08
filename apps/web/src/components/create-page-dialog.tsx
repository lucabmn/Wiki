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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Creates a page in `spaceId`. Rendered open whenever `spaceId` is non-null; the
 * caller nulls it on close. Real content enters via this flow — nothing seeded.
 */
export function CreatePageDialog({
  spaceId,
  onOpenChange,
}: {
  spaceId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();

  const create = useMutation(
    orpc.pages.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.pages.list.key() });
        setTitle("");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = () => {
    const trimmed = title.trim();
    if (spaceId && trimmed) {
      create.mutate({ spaceId, title: trimmed });
    }
  };

  return (
    <Dialog open={spaceId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Seite</DialogTitle>
          <DialogDescription>Die Seite wird als Entwurf im Space angelegt.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Seitentitel"
            maxLength={300}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={create.isPending || !title.trim()}>
              {create.isPending ? "Erstellen …" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
