import type { ReactNode } from "react";
import { Check, FileText, History, Search } from "lucide-react";

const FEATURES: [typeof Check, string][] = [
  [FileText, "Seiten, Spaces & seitengenaue Rechte"],
  [History, "Versionsverlauf & Kommentare"],
  [Search, "Volltextsuche über den ganzen Hub"],
];

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-svh font-sans lg:grid-cols-[1.1fr_1fr]">
      {/* ---- brand panel ---- */}
      <div className="relative hidden overflow-hidden bg-[oklch(0.26_0.09_262)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* cool accent glow — blue & indigo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(680px circle at 12% 8%, rgba(59,130,246,.38), transparent 50%), radial-gradient(520px circle at 92% 96%, rgba(99,102,241,.32), transparent 50%)",
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/12 text-lg font-bold ring-1 ring-white/20 backdrop-blur">
            N
          </div>
          <div className="text-[15px] leading-tight font-semibold">
            Nilovon Wiki
            <span className="block text-xs font-normal text-white/70">Wissens-Hub</span>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[38px] leading-[1.12] font-semibold tracking-tight">
            Das Wissen deines Teams, an einem Ort.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            Onboarding, Prozesse und Entscheidungen – dokumentiert, durchsuchbar und immer aktuell.
          </p>
          <ul className="mt-8 flex flex-col gap-3.5">
            {FEATURES.map(([Icon, label]) => (
              <li key={label} className="flex items-center gap-3 text-[14.5px] text-white/90">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                  <Icon className="size-3.5" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <figure className="relative max-w-md rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur">
          <blockquote className="text-[14.5px] leading-relaxed text-white/90">
            „Seit wir alles im Hub haben, findet jede:r im Team die Antwort selbst – Onboarding
            dauert halb so lang.“
          </blockquote>
          <figcaption className="mt-3 flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold ring-1 ring-white/25">
              SK
            </span>
            <span className="text-[13px]">
              <span className="font-semibold">Sarah König</span>
              <span className="block text-white/60">People &amp; Culture</span>
            </span>
          </figcaption>
        </figure>
      </div>

      {/* ---- form panel ---- */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          {/* mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm">
              N
            </div>
            <div className="text-[15px] leading-tight font-semibold">
              Nilovon Wiki
              <span className="block text-xs font-normal text-muted-foreground">Wissens-Hub</span>
            </div>
          </div>

          <h1 className="text-[30px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>
    </div>
  );
}
