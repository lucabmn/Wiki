import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { authSecretSchema, databaseUrlSchema, nodeEnvSchema } from "./shared";

export const env = createEnv({
  server: {
    DATABASE_URL: databaseUrlSchema,
    BETTER_AUTH_SECRET: authSecretSchema,
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    // Parent domain to scope auth cookies to, e.g. `.example.com`. Set this
    // when the web app and the API live on different subdomains *and* the web
    // app resolves the session server-side: its SSR middleware forwards the
    // browser's cookies for its own host, which never include a cookie the API
    // host issued host-only. Leave unset for a same-origin deployment, or when
    // the two hosts share no registrable parent — a `Domain` the browser
    // rejects (a public suffix like `co.uk`) drops the cookie entirely.
    COOKIE_DOMAIN: z
      .string()
      .regex(/^\.?([a-z0-9-]+\.)+[a-z]{2,}$/i, "must be a domain, e.g. .example.com")
      .optional(),
    NODE_ENV: nodeEnvSchema,
    // Display name used by Better Auth (emails, passkey prompts). Lets
    // self-hosters white-label without patching source.
    APP_NAME: z.string().min(1).default("Wiki"),
    // Port the real-time collaboration service (`apps/collab`) listens on.
    COLLAB_PORT: z.coerce.number().int().positive().default(1234),
    // Per-IP request ceilings (requests per minute). The general limit covers
    // /rpc and the REST surface; the auth limit protects /api/auth/* against
    // credential stuffing. Set high enough that normal usage never hits them.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),
    // SCIM (/api/auth/scim/**) is an identity provider syncing its directory,
    // not a person signing in: one request per user, all from one IP. It needs
    // a ceiling sized for a full directory push, not for credential stuffing.
    RATE_LIMIT_SCIM_MAX: z.coerce.number().int().positive().default(1200),

    // ── SMTP ────────────────────────────────────────────────────────────────
    // Optional as a whole: with SMTP_HOST unset the app still boots but mail is
    // not sent, so a single-user install needs no mail server. Message bodies
    // are never logged; invitations and password resets only work once it is set.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    // Implicit TLS (port 465). Port 587 upgrades via STARTTLS and stays false.
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().min(1).default("Wiki <no-reply@localhost>"),

    // ── Bundled notifications (digests) ─────────────────────────────────────
    // Delivery needs SMTP; without it the runner is a no-op and no cursor moves,
    // so configuring mail later loses nothing.
    //
    // The in-process ticker suits the long-lived container this ships as. Turn
    // it off where the process is not long-lived (serverless) or where several
    // replicas run and only an external scheduler should drive it — the runner
    // itself is idempotent either way, this only avoids pointless wake-ups.
    DIGEST_SCHEDULER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // How often the ticker looks for due digests. Sub-minute granularity buys
    // nothing for a daily mail, and every tick is a database round-trip.
    DIGEST_TICK_SECONDS: z.coerce.number().int().min(30).default(300),
    // Bearer token for POST /internal/digests/run. Unset leaves the endpoint
    // disabled — an unauthenticated trigger would let anyone drain the queue.
    DIGEST_RUN_TOKEN: z.string().min(16).optional(),

    // ── Object storage (S3-compatible: RustFS, MinIO, AWS S3, …) ────────────
    // Optional for the same reason: attachments stay disabled until configured.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(1).default("nilovon-wiki"),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Self-hosted S3 implementations (RustFS, MinIO) address buckets by path,
    // not by virtual host, so this defaults on and only AWS S3 needs it off.
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // Per-file upload ceiling. Uploads proxy through this process, so the limit
    // also bounds how much one request can make the server buffer.
    ATTACHMENT_MAX_MB: z.coerce.number().int().positive().default(25),

    // ── PDF export ──────────────────────────────────────────────────────────
    // PDFs are rendered in-process (no headless browser, see
    // `docs/export-format.md`), which keeps the image small but puts the work
    // on the API's CPU. These ceilings bound what one export request can cost.
    // Nothing is dropped silently: pages beyond the ceiling and pages that time
    // out still get a file in the archive explaining why.
    PDF_EXPORT_MAX_PAGES: z.coerce.number().int().positive().default(500),
    PDF_EXPORT_PAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
    // Ceiling for the per-export image cache. A logo repeated on every page is
    // fetched once; beyond this the cache stops growing rather than holding a
    // whole Space's images in memory.
    PDF_EXPORT_IMAGE_CACHE_MB: z.coerce.number().int().positive().default(64),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
