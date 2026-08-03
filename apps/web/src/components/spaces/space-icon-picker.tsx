import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { DEFAULT_SPACE_COLOR } from "@/lib/constants";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@nilovon-wiki/ui/components/popover";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * Curated presets — the same shape as the color swatches next to them. The free
 * text field below covers everything this list leaves out, so the grid stays
 * short enough to scan instead of growing into a full emoji catalogue.
 */
const SPACE_ICONS = [
  "📁",
  "📚",
  "📖",
  "📝",
  "📌",
  "📎",
  "🗂️",
  "🗃️",
  "🧭",
  "🧩",
  "🛠️",
  "⚙️",
  "🚀",
  "💡",
  "🎯",
  "📈",
  "📊",
  "💼",
  "🏢",
  "🏛️",
  "👥",
  "🤝",
  "🎨",
  "🖼️",
  "💬",
  "📣",
  "📅",
  "⏱️",
  "✅",
  "⭐",
  "🔥",
  "❤️",
  "🔒",
  "🔑",
  "🔍",
  "🧪",
  "🧠",
  "🤖",
  "💻",
  "🖥️",
  "🌍",
  "🌱",
  "☕",
  "🍀",
] as const;

/**
 * Renders the space badge exactly as the space list, sidebar and space header
 * do: the icon when one is set, the name's initial on the accent color when it
 * isn't. Used as the picker trigger so the preview matches the real thing.
 */
export function SpaceIconPreview({
  icon,
  name,
  color,
  className,
}: {
  icon: string | null;
  name: string;
  color: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm",
        className,
      )}
      style={{ backgroundColor: color ?? DEFAULT_SPACE_COLOR }}
    >
      {icon ? (
        <span className="text-base leading-none">{icon}</span>
      ) : (
        <span className="text-sm font-semibold leading-none">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}

/**
 * Icon picker for a space. `null` means "no icon" — the render sites then fall
 * back to the initial or the folder glyph, so clearing has to stay reachable.
 */
export function SpaceIconPicker({
  value,
  onChange,
  name,
  color,
  disabled,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  name: string;
  color: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value ?? "");

  // Re-seed the free text field whenever the popover opens, so it shows what is
  // actually selected rather than a stale draft from a previous visit.
  useEffect(() => {
    if (open) setCustom(value ?? "");
  }, [open, value]);

  const commitCustom = () => {
    const trimmed = custom.trim();
    // An empty string would pass the API's `max(64)` check and persist as a
    // non-null value that every render site treats as "no icon".
    onChange(trimmed === "" ? null : trimmed);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <button
              type="button"
              aria-label="Icon auswählen"
              className="rounded-lg transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SpaceIconPreview icon={value} name={name} color={color} />
            </button>
          }
        />
        <PopoverContent align="start" className="w-72">
          <div className="grid grid-cols-8 gap-1">
            {SPACE_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Icon ${emoji}`}
                aria-pressed={value === emoji}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-base leading-none transition-colors hover:bg-accent",
                  value === emoji && "bg-accent ring-2 ring-ring",
                )}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border pt-2.5">
            <label className="text-xs text-muted-foreground" htmlFor="space-icon-custom">
              Eigenes Emoji
            </label>
            <div className="flex gap-1.5">
              <Input
                id="space-icon-custom"
                value={custom}
                maxLength={64}
                placeholder="z. B. 🦊"
                className="h-8"
                onChange={(event) => setCustom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitCustom();
                  }
                }}
              />
              <Button type="button" size="sm" onClick={commitCustom}>
                Übernehmen
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <X className="size-3.5" />
          Icon entfernen
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          Kein Icon — es wird der Anfangsbuchstabe gezeigt.
        </span>
      )}
    </div>
  );
}
