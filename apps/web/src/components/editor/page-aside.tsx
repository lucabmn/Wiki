import { UserLink } from "@/components/user-link";
import { STATUS_LABEL } from "@/lib/labels";
import { scrollIntoPageView } from "@/lib/scroll";
import { orpc } from "@/utils/orpc";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, History, Link2, MessageSquare, Printer, Share2 } from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Heading } from "./headings";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * The page's right rail: an in-page table of contents with scroll-spy (the
 * heading currently near the top is highlighted), quick actions (version
 * history, jump to comments, share/export), and the page metadata.
 */
export function PageAside({
  page,
  headings,
  nameOf,
  commentCount,
  onOpenHistory,
  onJumpToComments,
}: {
  page: Page;
  headings: Heading[];
  nameOf: (userId: string | null) => string;
  commentCount: number;
  onOpenHistory: () => void;
  onJumpToComments: () => void;
}) {
  const toc = headings.filter((h) => h.text.length > 0);
  const activeId = useScrollSpy(toc.map((h) => h.id));

  const scrollTo = (id: string) => {
    const heading = document.getElementById(id);
    if (heading) scrollIntoPageView(heading);
  };

  return (
    <div className="space-y-4 text-[13px]">
      {toc.length ? (
        <nav aria-label="Inhaltsverzeichnis">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Auf dieser Seite
          </h2>
          <ul className="border-l border-border">
            {toc.map((heading) => {
              const active = heading.id === activeId;
              return (
                <li key={heading.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(heading.id)}
                    style={{ paddingLeft: (heading.level - 1) * 12 + 12 }}
                    className={cn(
                      "-ml-px block w-full truncate border-l-2 py-1 text-left transition-colors",
                      active
                        ? "border-primary font-medium text-primary"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {heading.text}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {toc.length ? <Separator /> : null}

      <div className="space-y-0.5">
        <ActionRow icon={History} label="Versionsverlauf" onClick={onOpenHistory} />
        <ActionRow
          icon={MessageSquare}
          label={`${commentCount} ${commentCount === 1 ? "Kommentar" : "Kommentare"}`}
          onClick={onJumpToComments}
        />
        <ShareMenu />
      </div>

      <Separator />

      <PageReferences pageId={page.id} />

      <dl className="space-y-2.5">
        <MetaRow label="Status">
          <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
        </MetaRow>
        {page.publishedAt ? (
          <MetaRow label="Veröffentlicht">{dayFormat.format(page.publishedAt)}</MetaRow>
        ) : null}
        <MetaRow label="Zuletzt geändert">{dateFormat.format(page.updatedAt)}</MetaRow>
        <MetaRow label="Erstellt am">{dayFormat.format(page.createdAt)}</MetaRow>
        <MetaRow label="Erstellt von">
          <UserLink userId={page.createdBy} name={nameOf(page.createdBy)} />
        </MetaRow>
        <MetaRow label="Bearbeitet von">
          <UserLink userId={page.lastEditedBy} name={nameOf(page.lastEditedBy)} />
        </MetaRow>
      </dl>
    </div>
  );
}

/**
 * Incoming and outgoing links for the page. The link graph is written on
 * publish (`lib/page-links.ts`); backlinks only count published sources, so an
 * empty list here is normal for a page nobody references yet — in that case the
 * whole block collapses rather than showing two empty headings.
 */
function PageReferences({ pageId }: { pageId: string }) {
  const { data: backlinks } = useQuery(
    orpc.links.backlinks.queryOptions({ input: { id: pageId } }),
  );
  const { data: outgoing } = useQuery(orpc.links.outgoing.queryOptions({ input: { id: pageId } }));

  if (!backlinks?.length && !outgoing?.length) return null;

  return (
    <>
      <ReferenceList title="Verlinkt von" pages={backlinks ?? []} />
      <ReferenceList title="Verweist auf" pages={outgoing ?? []} />
      <Separator />
    </>
  );
}

function ReferenceList({ title, pages }: { title: string; pages: Page[] }) {
  if (!pages.length) return null;
  return (
    <nav aria-label={title} className="space-y-1">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="space-y-0.5">
        {pages.map((linked) => (
          <li key={linked.id}>
            <Link
              to="/pages/$id"
              params={{ id: linked.id }}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="shrink-0 text-sm leading-none">
                {linked.icon ?? <FileText className="size-3.5" />}
              </span>
              <span className="truncate">{linked.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function ShareMenu() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = () => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };
  useEffect(() => clearResetTimer, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      clearResetTimer();
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          clearResetTimer();
          setCopied(false);
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Share2 className="size-4 shrink-0" />
            Teilen / Export
          </button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={copyLink}>
          <Link2 className="size-4" /> {copied ? "Link kopiert" : "Link kopieren"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.print()}>
          <Printer className="size-4" /> Drucken / PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Tracks which heading is currently near the top of the scroll container so the
 * TOC can highlight it. Observes the page's scroll container (`[data-page-scroll]`)
 * and activates the heading within the top band of the viewport.
 */
function useScrollSpy(ids: string[]): string | null {
  const key = ids.join("|");
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    const currentIds = key ? key.split("|") : [];
    if (!currentIds.length) return;
    setActiveId(currentIds[0] ?? null);

    const root = document.querySelector("[data-page-scroll]");
    const elements = currentIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveId(top.target.id);
      },
      // Activate a heading once it enters the top ~30% of the container.
      { root: root ?? null, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  return activeId;
}
