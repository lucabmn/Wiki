import { SpaceIconPicker } from "@/components/spaces/space-icon-picker";
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
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const invalidateSpaces = useInvalidate(orpc.spaces.list.key());

  const reset = () => {
    setName("");
    setIcon(null);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };

  const create = useMutation(
    orpc.spaces.create.mutationOptions({
      onSuccess: (space) => {
        invalidateSpaces();
        close();
        toast.success(`Space „${space.name}“ angelegt`);
        // Straight into the new space, like a new page opens its draft — the
        // dialog closing on its own was the only sign that anything happened.
        navigate({ to: "/spaces/$slug", params: { slug: space.slug } });
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      create.mutate({ name: trimmed, icon, visibility: "private" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
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
            aria-label="Space-Name"
            maxLength={120}
          />
          <div className="mt-3 space-y-1.5">
            <div className="text-xs text-muted-foreground">Icon</div>
            <SpaceIconPicker
              value={icon}
              onChange={setIcon}
              name={name.trim() || "Space"}
              color={null}
              disabled={create.isPending}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={close} disabled={create.isPending}>
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
