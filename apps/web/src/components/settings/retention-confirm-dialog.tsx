import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { orpc } from "@/utils/orpc";
import type { RetentionPolicy } from "@/components/settings/retention-form";
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
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * The confirmation an admin sees before a shortened window takes effect.
 *
 * "Are you sure?" is not consent to losing data. This asks the server what the
 * next run would actually remove under the proposed policy and puts those
 * numbers in the dialog, so the decision is made against the real cost.
 */
export function RetentionConfirmDialog({
  open,
  onOpenChange,
  policy,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: RetentionPolicy;
  pending: boolean;
  onConfirm: () => void;
}) {
  const impact = useQuery(
    orpc.retention.preview.queryOptions({
      input: policy,
      // Only asked while the dialog is open: it is a counting query over the
      // audit log, not something to run on every keystroke in the form.
      enabled: open,
    }),
  );

  const items = impact.data
    ? [
        { label: "Protokolleinträge", value: impact.data.auditRows },
        { label: "Seiten im Papierkorb", value: impact.data.trashedPages },
        { label: "Bereiche im Papierkorb", value: impact.data.trashedSpaces },
      ].filter((item) => item.value > 0)
    : [];
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aufbewahrungsfristen speichern?</AlertDialogTitle>
          <AlertDialogDescription>
            {impact.isPending
              ? "Es wird geprüft, was der nächste Lauf entfernen würde …"
              : total === 0
                ? "Beim nächsten Lauf wird nichts gelöscht. Die neuen Fristen greifen ab sofort für künftige Daten."
                : "Der nächste Aufräum-Lauf löscht damit endgültig:"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {impact.isPending ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : total > 0 ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-semibold tabular-nums">
                    {item.value.toLocaleString("de-DE")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <span>
                Diese Daten sind danach nicht wiederherstellbar. Objekte mit Löschsperre sind in
                dieser Zahl enthalten, werden aber nicht gelöscht, solange die Sperre besteht.
              </span>
            </p>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || impact.isPending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Speichern …" : total > 0 ? "Speichern und löschen" : "Speichern"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
