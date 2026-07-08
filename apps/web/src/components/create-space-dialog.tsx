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
 * Controlled dialog that creates a space in the active organization. Real data
 * enters the system through this flow — nothing is seeded.
 */
export function CreateSpaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const create = useMutation(
    orpc.spaces.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.spaces.list.key() });
        setName("");
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      create.mutate({ name: trimmed, visibility: "private" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuer Space</DialogTitle>
          <DialogDescription>
            Ein Space bündelt zusammengehörige Seiten. Sichtbarkeit lässt sich später ändern.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space-Name"
            maxLength={120}
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
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Erstellen …" : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
