import { ACTION_LABEL } from "@/lib/labels";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { Button } from "@nilovon-wiki/ui/components/button";

/**
 * Groups the raw `activity_action` list the server hands out into the four
 * things people actually think in. The grouping is derived from the action
 * prefix rather than hard-coded, so an action added to the enum shows up here
 * automatically instead of silently disappearing from the picker.
 */
const GROUPS = [
  { prefix: "page.", label: "Seiten" },
  { prefix: "comment.", label: "Kommentare" },
  { prefix: "attachment.", label: "Dateien" },
  { prefix: "space.", label: "Spaces" },
] as const;

export function WebhookEventPicker<T extends string>({
  available,
  selected,
  onChange,
  idPrefix,
  disabled,
}: {
  available: T[];
  selected: T[];
  onChange: (next: T[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const grouped: { label: string; events: T[] }[] = GROUPS.map((group) => ({
    label: group.label,
    events: available.filter((event) => event.startsWith(group.prefix)),
  })).filter((group) => group.events.length > 0);

  // Anything the grouping above does not recognise still has to be selectable.
  const ungrouped = available.filter(
    (event) => !GROUPS.some((group) => event.startsWith(group.prefix)),
  );
  if (ungrouped.length > 0) grouped.push({ label: "Weitere", events: ungrouped });

  const toggle = (event: T, checked: boolean) => {
    onChange(checked ? [...selected, event] : selected.filter((entry) => entry !== event));
  };

  return (
    <fieldset className="space-y-4" disabled={disabled}>
      {grouped.map((group) => {
        const allSelected = group.events.every((event) => selected.includes(event));
        return (
          <div key={group.label} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-xs font-medium text-muted-foreground">{group.label}</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    allSelected
                      ? selected.filter((entry) => !group.events.includes(entry))
                      : [...new Set([...selected, ...group.events])],
                  )
                }
              >
                {allSelected ? "Keines" : "Alle"}
              </Button>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.events.map((event) => (
                <label
                  key={event}
                  htmlFor={`${idPrefix}-${event}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm"
                >
                  <Checkbox
                    id={`${idPrefix}-${event}`}
                    checked={selected.includes(event)}
                    disabled={disabled}
                    onCheckedChange={(next) => toggle(event, next === true)}
                  />
                  <span className="min-w-0 truncate">{ACTION_LABEL[event] ?? event}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
