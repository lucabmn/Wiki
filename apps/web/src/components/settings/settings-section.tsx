import type { ReactNode } from "react";

import { Card } from "@nilovon-wiki/ui/components/card";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * One titled block inside a settings tab. Every tab is a stack of these, so the
 * heading rhythm and spacing stay identical across profile, security, org, …
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  /** Optional control rendered top-right, e.g. an "add" button. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The bordered body most sections use; kept separate so a section can opt out. */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("gap-4 p-4", className)}>{children}</Card>;
}
