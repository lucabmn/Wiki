import { orpc } from "@/utils/orpc";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check, FilePlus2, LayoutTemplate } from "lucide-react";

/** `null` selects the blank page — the option that always exists. */
export type TemplateChoice = string | null;

function Option({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  description,
  hint,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-input hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center text-sm leading-none",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
          {description}
        </span>
        {hint ? <span className="mt-1 block text-xs text-amber-600">{hint}</span> : null}
      </span>
      {selected ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

/**
 * "Leere Seite" plus the space's templates. The blank option is always first
 * and always available, so the picker never blocks the plain create flow — a
 * space with no templates simply shows one option and a hint.
 */
export function TemplatePicker({
  spaceId,
  value,
  onChange,
  disabled,
}: {
  spaceId: string;
  value: TemplateChoice;
  onChange: (value: TemplateChoice) => void;
  disabled?: boolean;
}) {
  const { data: templates, isPending } = useQuery(
    orpc.pages.listTemplates.queryOptions({
      input: { spaceId },
      enabled: Boolean(spaceId),
    }),
  );

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">Vorlage</div>
      <div
        role="radiogroup"
        aria-label="Vorlage"
        className="grid max-h-64 gap-1.5 overflow-y-auto pr-0.5"
      >
        <Option
          selected={value === null}
          disabled={disabled}
          onSelect={() => onChange(null)}
          icon={<FilePlus2 className="size-4" />}
          title="Leere Seite"
          description="Ohne Vorgaben starten."
        />
        {spaceId && isPending
          ? [0, 1].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
          : templates?.map((template) => (
              <Option
                key={template.id}
                selected={value === template.id}
                disabled={disabled}
                onSelect={() => onChange(template.id)}
                icon={template.icon ?? <LayoutTemplate className="size-4" />}
                title={template.title}
                description={template.excerpt || "Diese Vorlage hat noch keinen Inhalt."}
                // The body only reaches `content` on publish, so an unpublished
                // template would copy out empty. Say so before the click.
                hint={
                  template.hasContent
                    ? undefined
                    : "Noch nicht veröffentlicht — die neue Seite bleibt leer."
                }
              />
            ))}
      </div>
      {spaceId && !isPending && !templates?.length ? (
        <p className="text-xs text-muted-foreground">
          Dieser Space hat noch keine Vorlagen. Markiere eine Seite als Vorlage, um sie hier
          anzubieten.
        </p>
      ) : null}
    </div>
  );
}
