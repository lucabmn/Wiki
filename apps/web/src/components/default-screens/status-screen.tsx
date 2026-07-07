import type { ReactNode } from "react";

/**
 * Shared branded shell for full-page status screens (loading / error / 404).
 * Mirrors the brand aesthetic of AuthLayout: gradient glow, "N" mark, muted copy.
 */
export default function StatusScreen({
  icon,
  badge,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  badge?: string;
  title: string;
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 py-16 font-sans text-center">
      {/* decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px circle at 20% 0%, rgba(31,111,235,.16), transparent 45%), radial-gradient(500px circle at 85% 100%, rgba(31,111,235,.10), transparent 45%)",
        }}
      />

      <div className="relative flex w-full max-w-md flex-col items-center">
        {/* brand mark */}
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-primary to-blue-800 text-lg font-extrabold text-white shadow-sm">
            N
          </div>
          <div className="text-left text-[15px] leading-tight font-bold">
            Nilovon Wiki
            <span className="block text-xs font-medium text-muted-foreground">Wissens-Hub</span>
          </div>
        </div>

        {/* icon disc */}
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          {icon}
        </div>

        {badge && (
          <div className="mb-3 rounded-full bg-muted px-3 py-1 font-mono text-xs font-semibold text-muted-foreground">
            {badge}
          </div>
        )}

        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-muted-foreground">
          {message}
        </p>

        {children && <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
    </div>
  );
}
