import { createContext } from "@nilovon-wiki/api/context";
import { createAttachment } from "@nilovon-wiki/api/lib/attachments";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { appRouter } from "@nilovon-wiki/api/routers/index";
import { env } from "@nilovon-wiki/env/server";
import { call, ORPCError } from "@orpc/server";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";

/**
 * Binary transfer for attachments. Everything *about* an attachment (listing,
 * metadata, deletion, and the authorization behind them) stays in the oRPC
 * router; only the bytes move through here, because multipart bodies and
 * streamed responses do not fit an RPC envelope.
 *
 * Both directions proxy through the server rather than handing the browser a
 * presigned URL. That keeps the object store on the internal network only —
 * no public storage host, no bucket CORS, no separate signing endpoint.
 */
export const attachmentRoutes = new Hono();

const MAX_UPLOAD_BYTES = env.ATTACHMENT_MAX_MB * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

attachmentRoutes.post(
  "/upload",
  bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json({ message: `Datei ist größer als ${env.ATTACHMENT_MAX_MB} MB.` }, 413),
  }),
  async (c) => {
    const context = await createContext({ context: c });
    if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

    const form = await c.req.formData();
    const file = form.get("file");
    const spaceId = form.get("spaceId");
    const pageId = form.get("pageId");
    const draft = form.get("draft") === "true";

    if (!(file instanceof File)) return c.json({ message: "No file provided" }, 400);
    if (typeof spaceId !== "string" || !spaceId) {
      return c.json({ message: "spaceId is required" }, 400);
    }

    try {
      const row = await createAttachment(
        { ...context, session: context.session },
        {
          spaceId,
          pageId: typeof pageId === "string" && pageId ? pageId : null,
          draft,
          file: {
            // A browser-supplied name can contain path separators; the row keeps
            // it for display only, and the storage key is derived server-side.
            name: file.name.split(/[\\/]/).pop() || "datei",
            type: file.type || "application/octet-stream",
            size: file.size,
            body: file,
          },
        },
      );
      return c.json(row, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);

attachmentRoutes.get("/:id/inline", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

  try {
    const row = await call(appRouter.attachments.get, { id: c.req.param("id") }, { context });
    if (!INLINE_IMAGE_TYPES.has(row.mimeType.toLowerCase())) {
      return c.json({ message: "Dieser Dateityp kann nicht inline angezeigt werden" }, 415);
    }
    const storage = getStorage();
    if (!storage) return c.json({ message: "Attachments are disabled" }, 501);
    const stored = await storage.download(row.storageKey);
    return new Response(stored.stream(), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(row.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

attachmentRoutes.get("/:id/download", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

  try {
    // Authorization lives in the router procedure, so the proxy cannot drift
    // from the rules the RPC surface enforces.
    const row = await call(appRouter.attachments.get, { id: c.req.param("id") }, { context });

    const storage = getStorage();
    if (!storage) return c.json({ message: "Attachments are disabled" }, 501);

    const stored = await storage.download(row.storageKey);
    return new Response(stored.stream(), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(row.size),
        // `attachment` on purpose: rendering user-uploaded HTML or SVG inline
        // would execute it on our own origin.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

/** Maps an oRPC error onto the HTTP status its RPC counterpart would return. */
function errorResponse(c: Context, error: unknown) {
  if (error instanceof ORPCError) {
    return c.json({ message: error.message }, (error.status || 500) as ContentfulStatusCode);
  }
  throw error;
}
