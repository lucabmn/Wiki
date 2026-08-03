# Space export format

Nilovon Wiki exports a complete Space as a ZIP archive. The format is intended for backups,
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

Importers must check both `format` and `version`. New optional fields may be added without a
version change. Removing fields or changing their meaning requires a new version.

## Archive layout

```text
manifest.json
FORMAT.md
pages/<slug>--<page-id>/content.md     # Markdown export
pages/<slug>--<page-id>/index.html     # HTML export
pages/<slug>--<page-id>/content.json   # JSON export
attachments/<attachment-id>/<filename>
```

Paths use sanitized names and never contain user-controlled parent-directory segments. IDs make
paths unique even when titles or file names collide.

## Manifest

`manifest.json` is UTF-8 JSON and is the canonical index of the archive. It contains:

- export timestamp and selected content format;
- Space identity, presentation, visibility, and timestamps;
- all Space tags;
- all pages, including lifecycle metadata, `parentId`, sibling `position`, tags, curated external
  links, attachment IDs, plain-text projection, conversion warnings, and the exported body path;
- all attachment metadata and the path to the corresponding bytes.

The page tree is reconstructed by joining `pages[].parentId` to `pages[].id` and ordering siblings
by `position`. A `null` parent is a root page.

JSON page files contain `{ "page": <manifest page>, "content": <TipTap JSON document> }`.
Markdown and HTML are portable projections of the same TipTap document. Unsupported future node
or mark types degrade to their child text rather than being discarded wholesale. Malformed legacy
documents fall back to their plain-text projection and record a warning in the page manifest.

Known links to exported Nilovon pages and attachments are rewritten to relative archive paths.
External URLs remain unchanged.

## Attachments and access

Exports are available only to users who may manage the Space. The archive includes attachment
bytes, including draft attachments, because it represents the complete managed Space. If the Space
or an attachment is pending deletion, the export fails instead of racing cleanup and emitting a
silently incomplete archive.

If a Space has attachments but object storage is unavailable, the export also fails.

## HTTP endpoint

```text
GET /exports/spaces/:spaceId?format=markdown|html|json
```

The response is `application/zip`, uses `Content-Disposition: attachment`, and is marked
`private, no-store`. Authentication uses the normal Nilovon session cookie.

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
