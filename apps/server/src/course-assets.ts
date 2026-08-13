import { createContext } from "@nilovon-wiki/api/context";
import { createCourseAsset } from "@nilovon-wiki/api/lib/course-assets";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { assertTwoFactorCompliance } from "@nilovon-wiki/api/lib/two-factor-policy";
import { appRouter } from "@nilovon-wiki/api/routers/index";
import { env } from "@nilovon-wiki/env/server";
import { call, ORPCError } from "@orpc/server";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Binary transfer for course files — thumbnails, lesson videos and documents,
 * and learner hand-ins. The sibling of `attachments.ts`, and for the same
 * reason: multipart bodies and streamed responses do not fit an RPC envelope,
 * so only the bytes move through here while every decision about them stays in
 * the oRPC router.
 *
 * Both directions proxy through the server rather than handing the browser a
 * presigned URL, which keeps the object store on the internal network only.
 */
export const courseAssetRoutes = new Hono();

const MAX_UPLOAD_BYTES = env.ATTACHMENT_MAX_MB * 1024 * 1024;

/** Types safe to render in place. Everything else is served as a download. */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
]);

const ASSET_KINDS = new Set(["thumbnail", "video", "document", "submission", "other"]);

courseAssetRoutes.post(
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
    const courseId = form.get("courseId");
    const kind = form.get("kind");

    if (!(file instanceof File)) return c.json({ message: "No file provided" }, 400);
    if (typeof courseId !== "string" || !courseId) {
      return c.json({ message: "courseId is required" }, 400);
    }
    if (typeof kind !== "string" || !ASSET_KINDS.has(kind)) {
      return c.json({ message: "kind must be a known asset kind" }, 400);
    }

    try {
      // The read routes below authorize through the oRPC router, so its
      // middleware covers them. This one writes directly and has to ask itself.
      await assertTwoFactorCompliance(context.db, context.session);
      const row = await createCourseAsset(
        { ...context, session: context.session },
        {
          courseId,
          kind: kind as Parameters<typeof createCourseAsset>[1]["kind"],
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
      return c.json({ ...row, url: `/course-assets/${row.id}/inline` }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);

courseAssetRoutes.get("/:id/inline", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

  try {
    const row = await call(appRouter.courseAssets.get, { id: c.req.param("id") }, { context });
    if (!INLINE_TYPES.has(row.mimeType.toLowerCase())) {
      return c.json({ message: "Dieser Dateityp kann nicht inline angezeigt werden" }, 415);
    }
    const storage = getStorage();
    if (!storage) return c.json({ message: "Uploads are disabled" }, 501);

    // A video player asks for byte ranges as the learner scrubs. Answering 200
    // with the whole file would make every seek re-download the lesson, so the
    // range is honoured and passed through to the store.
    const range = parseRange(c.req.header("range"), row.size);
    if (range) {
      const stored = await storage.download(row.storageKey, {
        range: { start: range.start, end: range.end },
      });
      return new Response(stored.stream(), {
        status: 206,
        headers: {
          "Content-Type": row.mimeType,
          "Content-Length": String(range.end - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.end}/${row.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const stored = await storage.download(row.storageKey);
    return new Response(stored.stream(), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(row.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
        // Uploaded documents render in place; the sandbox is what stops one from
        // executing on our own origin.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

courseAssetRoutes.get("/:id/download", async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

  try {
    const row = await call(appRouter.courseAssets.get, { id: c.req.param("id") }, { context });
    const storage = getStorage();
    if (!storage) return c.json({ message: "Uploads are disabled" }, 501);

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

/**
 * The first range of a `Range: bytes=…` header, clamped to the object.
 *
 * Only single ranges are supported — that is what every browser media element
 * sends — and anything malformed returns null so the caller falls back to a
 * plain 200 rather than answering with a wrong slice.
 */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // A suffix range ("bytes=-500") asks for the last N bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Maps an oRPC error onto the HTTP status its RPC counterpart would return. */
function errorResponse(c: Context, error: unknown) {
  if (error instanceof ORPCError) {
    return c.json({ message: error.message }, (error.status || 500) as ContentfulStatusCode);
  }
  throw error;
}
