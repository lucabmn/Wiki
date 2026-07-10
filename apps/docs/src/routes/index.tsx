import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Building2,
  FileStack,
  GitBranch,
  History,
  KeyRound,
  Layers,
  Search,
  ShieldCheck,
  Terminal,
  Users,
  Zap,
} from "lucide-react";
import { Logo } from "@/lib/layout.shared";
import { appName, githubUrl } from "@/lib/shared";

export const Route = createFileRoute("/")({
  component: Home,
});

/** GitHub mark — lucide dropped brand icons, so we ship it inline. */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.02c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
        <TechStrip />
        <Features />
        <Architecture />
        <TypeSafety />
        <SelfHost />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/*
 * A self-contained marketing header. Deliberately NOT fumadocs' HomeLayout:
 * that layout renders a base-ui floating NavigationMenu whose hover store trips
 * React's hooks dispatcher during SSR, aborting the whole (un-suspended) home
 * shell. A plain header keeps the landing page fully server-rendered. Docs pages
 * still use fumadocs' DocsLayout, whose content streams inside Suspense.
 */
function MarketingHeader() {
  const nav = [
    { label: "Documentation", to: "" },
    { label: "Self-hosting", to: "self-hosting/docker" },
    { label: "API", to: "api-reference/overview" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-fd-border bg-fd-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold">
          <Logo className="size-6" />
          {appName}
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-fd-muted-foreground sm:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              to="/docs/$"
              params={{ _splat: n.to }}
              className="transition-colors hover:text-fd-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <a
          href={githubUrl}
          className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-fd-accent"
        >
          <GithubIcon className="size-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ Hero -- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-fd-border">
      <div className="hero-grid absolute inset-0 -z-10" />
      <div
        className="absolute inset-x-0 top-0 -z-10 h-[420px] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% -10%, color-mix(in oklch, var(--color-fd-primary) 22%, transparent), transparent)",
        }}
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <a
          href={githubUrl}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-3 py-1 text-sm text-fd-muted-foreground backdrop-blur transition-colors hover:text-fd-foreground"
        >
          <span className="inline-block size-1.5 rounded-full bg-fd-primary" />
          Open source · MIT licensed · Self-hostable
        </a>

        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          The type-safe wiki your team can <span className="text-fd-primary">actually own</span>.
        </h1>

        <p className="mt-6 max-w-2xl text-balance text-lg text-fd-muted-foreground">
          {appName} is a multi-tenant knowledge base — organizations, spaces, hierarchical pages,
          real-time collaboration and fine-grained access control — built on an end-to-end type-safe
          TypeScript stack you run on your own infrastructure.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
          >
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <a
            href={githubUrl}
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
          >
            <GithubIcon className="size-4" />
            Star on GitHub
          </a>
        </div>

        <Terminal_ />
      </div>
    </section>
  );
}

function Terminal_() {
  return (
    <div className="mt-14 w-full max-w-2xl overflow-hidden rounded-xl border border-fd-border bg-fd-card text-left shadow-lg">
      <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5">
        <span className="size-3 rounded-full bg-red-400/70" />
        <span className="size-3 rounded-full bg-yellow-400/70" />
        <span className="size-3 rounded-full bg-green-400/70" />
        <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-fd-muted-foreground">
          <Terminal className="size-3.5" />
          install.sh
        </span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code>
          <span className="text-fd-muted-foreground">
            {"# clone, download the guided installer, run it\n"}
          </span>
          <span className="text-fd-primary">git</span> clone https://github.com/Nilovon/Wiki.git
          {"\n"}
          <span className="text-fd-primary">cd</span> Wiki &&{" "}
          <span className="text-fd-primary">./installer</span>
          {"\n\n"}
          <span className="text-fd-muted-foreground">
            {"# → generates secrets, writes .env, brings the stack up\n"}
          </span>
          <span className="text-fd-muted-foreground">
            {"# → open http://localhost:3001 and register\n"}
          </span>
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------- Tech strip -- */

const TECH = [
  "React 19",
  "TanStack Start",
  "Hono",
  "oRPC",
  "Better Auth",
  "PostgreSQL",
  "Drizzle ORM",
  "Zod",
  "Tailwind CSS 4",
];

function TechStrip() {
  return (
    <section className="border-b border-fd-border bg-fd-card/30">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-fd-muted-foreground">
          One end-to-end type-safe stack
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
          {TECH.map((t) => (
            <span
              key={t}
              className="rounded-full border border-fd-border bg-fd-background px-3.5 py-1.5 text-sm text-fd-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Features -- */

const FEATURES = [
  {
    icon: Building2,
    title: "Multi-tenant by default",
    body: "Every piece of content lives inside an organization. Every query is org-scoped and enforced server-side — tenants never see each other's data.",
  },
  {
    icon: FileStack,
    title: "Spaces & hierarchical pages",
    body: "Group pages into spaces with public / private / restricted visibility. Pages nest into a tree with fractional (LexoRank) ordering and a draft → published → archived lifecycle.",
  },
  {
    icon: KeyRound,
    title: "Fine-grained access control",
    body: "Static and dynamic roles via Better Auth's organization plugin. Reads gate on space visibility; mutations gate on organization permissions.",
  },
  {
    icon: Users,
    title: "Real-time collaboration",
    body: "Edit pages together with live cursors, powered by a Hocuspocus + Yjs service and a shared TipTap schema. Conflict-free, offline-tolerant.",
  },
  {
    icon: Search,
    title: "Full-text search",
    body: "PostgreSQL tsvector generated columns with GIN indexes deliver instant, ranked search across every page you're allowed to see.",
  },
  {
    icon: Zap,
    title: "Type-safe API",
    body: "A single oRPC router definition drives both the type-safe /rpc surface and a generated OpenAPI document — no drift between client and server.",
  },
  {
    icon: History,
    title: "Audit log & activity feed",
    body: "Every mutation appends an audit row inside the same transaction — including destructive deletes — so you always have a trail.",
  },
  {
    icon: ShieldCheck,
    title: "Yours to self-host",
    body: "Docker Compose, a guided TTY installer, and automatic HTTPS via a bundled Caddy proxy. No SaaS, no seats, no lock-in.",
  },
];

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeading
        eyebrow="Features"
        title="Everything a team wiki needs — and nothing it doesn't"
        subtitle="Batteries included: content model, collaboration, search, permissions and auditing, all wired together and type-checked from database to browser."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group bg-fd-background p-6 transition-colors hover:bg-fd-card"
          >
            <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg border border-fd-border bg-fd-card text-fd-primary transition-colors group-hover:border-fd-primary/40">
              <f.icon className="size-5" />
            </div>
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Architecture -- */

function Architecture() {
  return (
    <section className="border-y border-fd-border bg-fd-card/30">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeading
          eyebrow="Architecture"
          title="A clean boundary between transport, logic and clients"
          subtitle="The web and terminal clients talk to a Hono server over a type-safe oRPC client. All business logic and data contracts live in one place; the database, auth and env are isolated packages."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="grid gap-4">
            <Node
              icon={Layers}
              title="apps/web · apps/tui"
              sub="React (TanStack Start) & OpenTUI clients"
            />
          </div>
          <div className="flex items-center justify-center text-fd-muted-foreground">
            <ArrowRight className="hidden size-6 lg:block" />
          </div>
          <div className="grid gap-4">
            <Node icon={GitBranch} title="apps/server" sub="Hono + oRPC handler · /rpc · /v1" />
            <Node
              icon={Zap}
              title="packages/api"
              sub="Routers · Zod schemas · access control"
              accent
            />
            <div className="grid grid-cols-3 gap-3">
              <MiniNode title="packages/db" sub="Drizzle + PG" />
              <MiniNode title="packages/auth" sub="Better Auth" />
              <MiniNode title="packages/env" sub="typed env" />
            </div>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-sm text-fd-muted-foreground">
          Reads are gated on space visibility; mutations are gated on organization role. Every write
          runs in a transaction and appends an audit row.
        </p>
      </div>
    </section>
  );
}

function Node({
  icon: Icon,
  title,
  sub,
  accent,
}: {
  icon: typeof Zap;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 ${
        accent ? "border-fd-primary/40 bg-fd-primary/5" : "border-fd-border bg-fd-background"
      }`}
    >
      <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-fd-card text-fd-primary">
        <Icon className="size-5" />
      </div>
      <div>
        <p className="font-mono text-sm font-medium">{title}</p>
        <p className="text-xs text-fd-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function MiniNode({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-background p-3 text-center">
      <p className="font-mono text-xs font-medium">{title}</p>
      <p className="mt-0.5 text-[11px] text-fd-muted-foreground">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------- Type safety -- */

function TypeSafety() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Type safety, end to end"
            title="Define it once. Trust it everywhere."
            subtitle="One oRPC router is the single source of truth. The client is fully typed from it, and the same definition generates your OpenAPI spec — so refactors surface as compile errors, not production incidents."
          />
          <Link
            to="/docs/$"
            params={{ _splat: "architecture/api" }}
            className="mt-8 inline-flex items-center gap-2 font-medium text-fd-primary hover:underline"
          >
            Read the API architecture
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5 text-xs text-fd-muted-foreground">
            <GitBranch className="size-3.5" />
            packages/api → apps/web
          </div>
          <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
            <code>{`// server — one definition
export const pages = {
  create: authed
    .input(createPageSchema)
    .handler(({ input, ctx }) =>
      db.insert(page).values(input)),
}

// client — inferred, no codegen
const page = await client.pages.create({
  spaceId,
  title: "Runbook",   // ✅ types checked
})
//    ^? { id: string; slug: string; ... }`}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Self host -- */

const STEPS = [
  {
    n: "01",
    t: "Clone & run the installer",
    d: "A self-contained terminal wizard generates strong secrets and writes your .env files.",
  },
  {
    n: "02",
    t: "Stack comes up",
    d: "Postgres, server, web and collab start via Docker Compose; migrations run automatically.",
  },
  {
    n: "03",
    t: "Register & onboard",
    d: "Open the app, create your first organization, optionally seed sample content.",
  },
];

function SelfHost() {
  return (
    <section className="border-y border-fd-border bg-fd-card/30">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeading
          eyebrow="Self-hosting"
          title="Up and running in three steps"
          subtitle="The only requirement is Docker with the Compose plugin. Public deployment with automatic HTTPS is a matter of entering https:// URLs and a Let's Encrypt email."
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-fd-border bg-fd-background p-6">
              <span className="font-mono text-sm text-fd-primary">{s.n}</span>
              <h3 className="mt-3 font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <Link
            to="/docs/$"
            params={{ _splat: "self-hosting/docker" }}
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-background px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
          >
            <BookOpen className="size-4" />
            Full self-hosting guide
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Final CTA -- */

function FinalCta() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-28 text-center">
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        Own your team's knowledge base.
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-balance text-fd-muted-foreground">
        Read the docs, spin it up on your own hardware, and make it yours. It's MIT licensed — no
        seats, no lock-in.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/docs/$"
          params={{ _splat: "" }}
          className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground shadow-sm transition-transform hover:scale-[1.02]"
        >
          Read the docs
          <ArrowRight className="size-4" />
        </Link>
        <a
          href={githubUrl}
          className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
        >
          <GithubIcon className="size-4" />
          View source
        </a>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- Footer -- */

function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-fd-muted-foreground sm:flex-row">
        <p>© {appName}. Released under the MIT License.</p>
        <nav className="flex items-center gap-6">
          <Link to="/docs/$" params={{ _splat: "" }} className="hover:text-fd-foreground">
            Docs
          </Link>
          <Link
            to="/docs/$"
            params={{ _splat: "self-hosting/docker" }}
            className="hover:text-fd-foreground"
          >
            Self-hosting
          </Link>
          <a href={githubUrl} className="hover:text-fd-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ utils -- */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  const isCenter = align === "center";
  return (
    <div className={isCenter ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-xs font-medium uppercase tracking-widest text-fd-primary">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className={`mt-4 text-fd-muted-foreground ${isCenter ? "text-balance" : ""}`}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
