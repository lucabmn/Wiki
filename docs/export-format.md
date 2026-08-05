# Space export format

Wiki exports a complete Space as a ZIP archive. The format is intended for backups,
migrations, self-hosting portability, and third-party importers.

## Versioning

Every archive contains `manifest.json` with:

```json
{
  "format": "nilovon-space-export",
  "version": 1,
  "contentFormat": "markdown"
}
```

`contentFormat` is one of `markdown`, `html`, `json`, `pdf`.

Importers must check both `format` and `version`. New optional fields may be added without a
version change. Removing fields or changing their meaning requires a new version.

## Archive layout

```text
manifest.json
FORMAT.md
pages/<slug>--<page-id>/content.md     # Markdown export
pages/<slug>--<page-id>/index.html     # HTML export
pages/<slug>--<page-id>/content.json   # JSON export
pages/<slug>--<page-id>/content.pdf    # PDF export
EXPORT-REPORT.md                       # PDF export only, and only when a limit applied
```

The directory layout is identical across formats — only the body file name changes — so the page
hierarchy is reconstructed the same way regardless of the format chosen.

Paths use sanitized names and never contain user-controlled parent-directory segments. IDs make
paths unique even when titles or file names collide.

## Manifest

`manifest.json` is UTF-8 JSON and is the canonical index of the archive. It contains:

- export timestamp and selected content format;
- Space identity, presentation, visibility, and timestamps;
- all Space tags;
- all pages, including lifecycle metadata, `parentId`, sibling `position`, tags, curated external
  links, attachment IDs, plain-text projection, conversion warnings, and the exported body path;
- all attachment metadata and the path to the corresponding bytes;
- for PDF exports, a `limits` object recording the ceilings that were in force.

The page tree is reconstructed by joining `pages[].parentId` to `pages[].id` and ordering siblings
by `position`. A `null` parent is a root page.

Page templates are exported like any other page and are marked with `pages[].isTemplate: true`.
They are hidden from the in-app page tree, search, backlinks, the dashboard and the digest, but an
export represents the complete Space — consumers that want content only should filter on the flag.

JSON page files contain `{ "page": <manifest page>, "content": <TipTap JSON document> }`.
Markdown, HTML and PDF are projections of the same TipTap document. Unsupported future node
or mark types degrade to their child text rather than being discarded wholesale. Malformed legacy
documents fall back to their plain-text projection and record a warning in the page manifest.

Known links to exported pages and attachments are rewritten to relative archive paths.
External URLs remain unchanged.

## PDF export

PDF is the format organisations actually ask for: something to read, print and hand to someone who
will never open a Markdown file. It sits alongside the portability formats rather than replacing
them.

### Why no headless browser

PDFs are rendered **in-process** from the same TipTap document the other formats project from, using
a PDF library — not by driving a headless Chromium.

Chromium would render the app's own CSS and win on fidelity. It would also add 300–500 MB to the
server image, a sandbox to configure, a class of zombie-process and memory-spike failures to
operate, and — if isolated properly — a second Compose service, a health check and another installer
question. Wiki's promise is "the only prerequisite is Docker" plus a guided installer, so that cost
lands harder here than it would elsewhere. In-process rendering keeps the image the size it was, adds
no new failure mode that can take the API down with it, and needs no deployment change at all.

What it costs: layout is Wiki's own, not the browser's, so a PDF looks like a document rather than
like the web app. Text uses the PDF standard fonts, which cover Latin-1 (including German umlauts);
scripts outside that range — Cyrillic, Greek, CJK — are not rendered. Highlight marks lose their
background colour and render as plain text.

### Layout

- Print layout only: no navigation, no rails, no buttons, and light colours throughout — a dark-mode
  reader still gets a printable page.
- A4 with a running header (Space, export date) and footer (page title, "page n of m").
- The page title, its breadcrumb of ancestor pages and a rule open the first page.
- Code blocks keep their background across page breaks and hard-wrap instead of being cut off at the
  right margin.
- Tables break between rows, never inside one, and repeat their header row on each new page.
- Headings are kept with the text that follows them.

### Images and links

Images are **embedded**, not referenced: a PDF pointing at a private object store would be an empty
PDF. PNG and JPEG attachments and `data:` images are embedded; other types degrade to their alt
text, as does an image that cannot be loaded. In a single-page export each referenced attachment is
authorized individually through the same procedure the inline attachment route uses, so an export
can never surface bytes the caller could not open in the app.

Internal links follow the format's existing rule:

- **In a Space archive** they point at the sibling `content.pdf` by relative path — the same
  rewriting Markdown and HTML get, so an unpacked archive stays navigable offline.
- **In a single-page export** there are no sibling files, so links are absolutized against the web
  app's origin (`CORS_ORIGIN`) and resolve against the live instance.

External links are never rewritten.

### Limits

Rendering is CPU-bound and happens inside the request, so a Space with thousands of pages is bounded
rather than trusted. Pages render strictly one at a time; peak memory stays at roughly one page.

| Variable                     | Default | Meaning                                     |
| ---------------------------- | ------- | ------------------------------------------- |
| `PDF_EXPORT_MAX_PAGES`       | `500`   | Pages rendered per Space export             |
| `PDF_EXPORT_PAGE_TIMEOUT_MS` | `15000` | Wall-clock budget for one page              |
| `PDF_EXPORT_IMAGE_CACHE_MB`  | `64`    | Ceiling for the per-export image byte cache |

Nothing is ever cut off silently. A page beyond the ceiling, past its timeout, or failing to render
still gets a file at its usual archive path — a one-page PDF stating the reason. In addition:

- `manifest.json` gains a `limits` object (`maxPages`, `pageTimeoutMs`, `skippedPageIds`), and each
  affected page carries an explanatory entry in its `warnings`;
- `EXPORT-REPORT.md` lists every page that did not render normally, with the reason.

A single-page export is subject to the per-page timeout only.

## Attachments and access

Exports are available only to users who may manage the Space. The archive includes attachment
bytes, including draft attachments, because it represents the complete managed Space. If the Space
or an attachment is pending deletion, the export fails instead of racing cleanup and emitting a
silently incomplete archive.

If a Space has attachments but object storage is unavailable, the export also fails.

## HTTP endpoints

```text
GET /exports/spaces/:spaceId?format=markdown|html|json|pdf
GET /exports/pages/:pageId?format=markdown|html|json|pdf
```

The Space response is `application/zip`. The single-page response is the file itself — no ZIP —
with the format's own content type. Both use `Content-Disposition: attachment`, are marked
`private, no-store`, and authenticate with the normal session cookie.

The two endpoints are gated differently on purpose:

- the Space archive requires `manage` on the Space;
- a single page is checked at **page** level, so a page carrying a restrictive per-page override is
  not exportable by someone who can merely read the Space around it.

HTML and JSON are served as attachments too, never inline: rendering exported page content on the
application's own origin would execute it there.

## Import guidance

A compatible importer should:

1. reject unknown `format` or unsupported `version` values;
2. validate every archive path before extraction (no absolute paths or `..` segments);
3. create the Space and tags first;
4. create pages in parent-before-child order while preserving `position`;
5. upload attachments and replace relative attachment references with the new attachment URLs;
6. map old IDs to new IDs when recreating page links and hierarchy;
7. preserve unknown metadata where practical and report lossy conversions.

Exports use the latest rich-text content persisted in PostgreSQL. Changes still present only in an
active Yjs collaboration session may not appear until the collaboration service has projected them
back to the page row. The archive is therefore a portability export, not a replacement for the
operator's coordinated PostgreSQL and object-storage backups.

Nilovon's existing HTML importer can ingest individual exported HTML pages. A full archive importer
is not yet part of format version 1; this specification is the contract for implementing one.
