import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { cn } from "@nilovon-wiki/ui/lib/utils";

export const Route = createFileRoute("/_auth/settings/appearance")({
  component: AppearanceSettings,
});

const THEMES = [
  { value: "light", label: "Hell", icon: Sun },
  { value: "dark", label: "Dunkel", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Purely local: the theme lives in localStorage (see `theme-provider`), so it is
 * per-device and needs no server round-trip — and no permission check.
 */
function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Erscheinungsbild"
        description="Gilt nur auf diesem Gerät und wird lokal gespeichert."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border border-primary/15 bg-card p-4 text-sm font-medium ring-1 ring-foreground/10 transition-colors hover:bg-accent",
                  active ? "border-primary ring-primary" : undefined,
                )}
              >
                <option.icon className="size-5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>
    </div>
  );
}
