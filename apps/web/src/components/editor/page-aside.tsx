import { STATUS_LABEL } from "@/lib/labels";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import type { ReactNode } from "react";

import type { Heading } from "./headings";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/**
 * The page's right rail: an in-page table of contents that scrolls to headings,
 * and the page's metadata (status, timestamps, author/editor). Author ids are
 * resolved to names via `nameOf`, backed by the org's member list.
 */
export function PageAside({
  page,
  headings,
  nameOf,
}: {
  page: Page;
  headings: Heading[];
  nameOf: (userId: string | null) => string;
}) {
  const toc = headings.filter((h) => h.text.length > 0);

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-6">
      {toc.length ? (
        <nav aria-label="Inhaltsverzeichnis">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Auf dieser Seite
          </h2>
          <ul className="border-l border-border">
            {toc.map((heading) => (
              <li key={heading.id}>
                <button
                  type="button"
                  onClick={() => scrollTo(heading.id)}
                  style={{ paddingLeft: (heading.level - 1) * 12 + 12 }}
                  className="-ml-px block w-full truncate border-l-2 border-transparent py-1 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <dl className="space-y-2.5 text-[13px]">
        <MetaRow label="Status">
          <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
        </MetaRow>
        {page.publishedAt ? (
          <MetaRow label="Veröffentlicht">{dayFormat.format(page.publishedAt)}</MetaRow>
        ) : null}
        <MetaRow label="Zuletzt geändert">{dateFormat.format(page.updatedAt)}</MetaRow>
        <MetaRow label="Erstellt am">{dayFormat.format(page.createdAt)}</MetaRow>
        <MetaRow label="Erstellt von">{nameOf(page.createdBy)}</MetaRow>
        <MetaRow label="Bearbeitet von">{nameOf(page.lastEditedBy)}</MetaRow>
      </dl>
    </div>
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
