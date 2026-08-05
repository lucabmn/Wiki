import { createContext, type AuthedContext } from "@nilovon-wiki/api/context";
import { requirePageCapability } from "@nilovon-wiki/api/lib/authz";
import { loadPage, loadSpace } from "@nilovon-wiki/api/lib/loaders";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { assertTwoFactorCompliance } from "@nilovon-wiki/api/lib/two-factor-policy";
import { appRouter } from "@nilovon-wiki/api/routers/index";
import { env } from "@nilovon-wiki/env/server";
import { call, ORPCError } from "@orpc/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { pdfExportLimits, renderPagePdf } from "./export-pdf";
import { resolveLiveUrl } from "./export-urls";
import { createImageLoader } from "./pdf/pdf-images";
import {
  documentToHtml,
  type ExportFormat,
  normalizeDocument,
  rewriteDocumentUrls,
  safeArchiveName,
} from "./space-export-format";
import { documentToMarkdown } from "./space-export-markdown";

/**
 * Single-page export.
 *
 * Deliberately gated on the **page**, not on the Space: a page carrying a
 * restrictive per-page override must not become exportable just because the
 * caller can read the Space around it. Unlike the Space archive this needs no
 * ZIP — one page is one file.
 *
 * Internal links are absolutized against the web app's origin: a lone file has
 * no sibling pages to point at, so a live URL is the only target that resolves.
 */
export const pageExportRoutes = new Hono();

const FORMATS = new Set<ExportFormat>(["markdown", "html", "json", "pdf"]);

const CONTENT_TYPE: Record<ExportFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
};

const EXTENSION: Record<ExportFormat, string> = {
  markdown: "md",
  html: "html",
  json: "json",
  pdf: "pdf",
};

pageExportRoutes.get("/pages/:id", async (c) => {
  const format = c.req.query("format") as ExportFormat | undefined;
  if (!format || !FORMATS.has(format)) {
    return c.json({ message: "format must be markdown, html, json, or pdf" }, 400);
  }

  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);
  const authedContext = context as AuthedContext;

  try {
    const page = await loadPage(context.db, c.req.param("id"));
    // Exports bypass oRPC, so the two-factor policy has to be asserted here.
    await assertTwoFactorCompliance(context.db, context.session);
    await requirePageCapability(context.db, authedContext, context.headers, page, "read");
    const space = await loadSpace(context.db, page.spaceId);

    const { content } = normalizeDocument(page.content, page.textContent);
    const resolveLink = (url: string) => resolveLiveUrl(url, env.CORS_ORIGIN);
    const fileName = `${safeArchiveName(page.slug || page.title, "page")}.${EXTENSION[format]}`;

    const payload =
      format === "pdf"
        ? (
            await renderPagePdf(
              content,
              { title: page.title, spaceName: space.name, exportedAt: new Date() },
              {
                loadImage: attachmentImages(authedContext),
                resolveLink,
                timeoutMs: pdfExportLimits().pageTimeoutMs,
              },
            )
          ).bytes
        : textBody(format, rewriteDocumentUrls(content, resolveLink), page.title);

    return new Response(payload, {
      headers: {
        "Content-Type": CONTENT_TYPE[format],
        // `attachment` for every format on purpose: rendering exported HTML
        // inline would run page content on this origin.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ORPCError) {
      return c.json({ message: error.message }, (error.status || 500) as ContentfulStatusCode);
    }
    throw error;
  }
});

function textBody(format: ExportFormat, content: unknown, title: string): string {
  if (format === "markdown") return documentToMarkdown(content, title);
  if (format === "html") return documentToHtml(content, title);
  return `${JSON.stringify({ content }, null, 2)}\n`;
}

/**
 * Image bytes for the PDF, authorized one attachment at a time through the same
 * procedure the inline attachment route uses — a page export must not become a
 * way to read attachments the caller could not open in the app.
 */
function attachmentImages(context: AuthedContext) {
  return createImageLoader({
    storage: getStorage(),
    resolve: async (id) => {
      try {
        return await call(appRouter.attachments.get, { id }, { context });
      } catch {
        return null;
      }
    },
    maxBytes: pdfExportLimits().maxImageBytes,
    cacheBytes: pdfExportLimits().cacheBytes,
  });
}
