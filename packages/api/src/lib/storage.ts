import { ORPCError } from "@orpc/server";

import { env } from "@nilovon-wiki/env/server";
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

/**
 * Object storage for attachments, backed by any S3-compatible service (the
 * bundled RustFS, MinIO, AWS S3, …).
 *
 * Bytes never travel between the browser and the bucket directly: the server
 * proxies both directions. That keeps the store reachable on the internal
 * network only — no public endpoint, no bucket CORS, no split
 * signing/serving host — at the cost of the upload passing through the API
 * process. Presigned URLs are the scaling escape hatch, not the v1 default.
 */

let files: Files | null | undefined;

/** True once an operator has pointed S3_* at a real bucket. */
export function isStorageConfigured(): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

/**
 * Lazily built so an install without storage configured never constructs a
 * client. Returns null when unconfigured; callers surface that as a
 * "attachments are disabled" error rather than a stack trace.
 */
export function getStorage(): Files | null {
  if (files !== undefined) return files;
  if (!isStorageConfigured()) {
    files = null;
    return null;
  }
  files = new Files({
    adapter: s3({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    }),
  });
  return files;
}

/**
 * `getStorage` for upload paths: throws the user-facing "uploads are off" error
 * instead of returning null.
 */
export function requireStorage(): Files {
  const storage = getStorage();
  if (!storage) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message:
        "Datei-Uploads sind deaktiviert, weil kein Objektspeicher eingerichtet ist (S3_* in der .env).",
    });
  }
  return storage;
}

/** Swap the storage instance — for tests running against the memory adapter. */
export function setStorage(instance: Files | null) {
  files = instance;
}

/**
 * Storage key for an upload. Space-prefixed so a bucket listing is grouped the
 * way the app is, and suffixed with a random id so two uploads of the same
 * file name never collide. The original name is *not* part of the key —
 * it lives in the database row, which keeps user-controlled text out of paths.
 */
export function buildStorageKey(spaceId: string, fileName: string): string {
  return `spaces/${spaceId}/${crypto.randomUUID()}${safeExtension(fileName)}`;
}

/**
 * The file name's extension, lower-cased, if it is short and alphanumeric —
 * otherwise nothing. The only part of a user-supplied name that reaches a key.
 */
export function safeExtension(fileName: string): string {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
  return /^\.[A-Za-z0-9]{1,12}$/.test(extension) ? extension.toLowerCase() : "";
}
