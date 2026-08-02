import { createContext } from "@nilovon-wiki/api/context";
import { createAttachment } from "@nilovon-wiki/api/lib/attachments";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { appRouter } from "@nilovon-wiki/api/routers/index";
import { env } from "@nilovon-wiki/env/server";
import { call, ORPCError } from "@orpc/server";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { bodyLimit } from "hono/body-limit";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const a = octets[0]!;
  const b = octets[1]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Ungültige Asset-URL" });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ORPCError("BAD_REQUEST", { message: "Nur öffentliche HTTP(S)-Assets sind erlaubt" });
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ORPCError("BAD_REQUEST", { message: "Private oder nicht auflösbare Asset-Adresse" });
  }
  return url;
}

async function fetchRemoteAsset(raw: string): Promise<{ body: Blob; type: string; name: string }> {
  let url = await assertPublicUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Nilovon-Wiki-Migration/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) {
        throw new ORPCError("BAD_REQUEST", { message: "Zu viele Asset-Weiterleitungen" });
      }
      url = await assertPublicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Asset konnte nicht geladen werden (${response.status})`,
      });
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_UPLOAD_BYTES) {
      throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "Remote-Asset ist zu groß" });
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "Remote-Asset ist zu groß" });
      }
      chunks.push(value);
    }
    const type =
      response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const rawName = url.pathname.split("/").pop() || "remote-asset";
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      // Keep the encoded URL segment; it is display text only.
    }
    name = name.split(/[\\/]/).pop()?.slice(0, 255) || "remote-asset";
    return { body: new Blob(chunks, { type }), type, name };
  }
  throw new ORPCError("BAD_REQUEST", { message: "Asset konnte nicht geladen werden" });
}

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

attachmentRoutes.post("/import-url", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);

  try {
    const payload = (await c.req.json()) as { url?: unknown; spaceId?: unknown; pageId?: unknown };
    if (
      typeof payload.url !== "string" ||
      typeof payload.spaceId !== "string" ||
      !payload.spaceId ||
      typeof payload.pageId !== "string" ||
      !payload.pageId
    ) {
      return c.json({ message: "url, spaceId und pageId sind erforderlich" }, 400);
    }
    const remote = await fetchRemoteAsset(payload.url);
    const row = await createAttachment(
      { ...context, session: context.session },
      {
        spaceId: payload.spaceId,
        pageId: payload.pageId,
        file: {
          name: remote.name,
          type: remote.type,
          size: remote.body.size,
          body: remote.body,
        },
      },
    );
    return c.json(row, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

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
