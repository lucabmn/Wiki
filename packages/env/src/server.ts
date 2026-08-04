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
    // Where this process reaches the collab service, for the admin console's
    // "collab reachable" probe. Defaults to loopback (the dev layout, where all
    // three apps share a host); under docker-compose the service lives on its
    // own container and this must point at it.
    COLLAB_INTERNAL_URL: z.url().optional(),
    // Reported verbatim in the admin console's instance overview — the first
    // thing anyone asks for in a support case. Set from the image tag.
    APP_VERSION: z.string().min(1).default("dev"),
    // Per-IP request ceilings (requests per minute). The general limit covers
    // /rpc and the REST surface; the auth limit protects /api/auth/* against
    // credential stuffing. Set high enough that normal usage never hits them.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),
    // SCIM (/api/auth/scim/**) is an identity provider syncing its directory,
    // not a person signing in: one request per user, all from one IP. It needs
    // a ceiling sized for a full directory push, not for credential stuffing.
    RATE_LIMIT_SCIM_MAX: z.coerce.number().int().positive().default(1200),

    // ── Instance administration ─────────────────────────────────────────────
    // Bootstraps the first instance admin. `user.role` is nullable and nothing
    // sets it at registration, so on a fresh instance nobody can open the admin
    // console — a chicken-and-egg the operator has to break from outside the
    // app. The address is matched case-insensitively and promoted at startup as
    // well as at registration, so it works whether the account already exists
    // or is created later. Existing admins are never demoted by changing it.
    INITIAL_ADMIN_EMAIL: z.email().optional(),
    // Hard kill-switch for impersonation. Some operators (works councils,
    // regulated industries) must be able to prove the capability is absent
    // rather than merely audited, so this is enforced server-side — the UI only
    // mirrors it.
    IMPERSONATION_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // How long an impersonated session survives on its own. Short by design: a
    // forgotten tab must not stay signed in as someone else for a working day.
    IMPERSONATION_MAX_MINUTES: z.coerce.number().int().min(1).max(480).default(30),

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
    // Legacy alias of INTERNAL_RUN_TOKEN below, kept working so existing
    // deployments keep triggering digests after an update. Prefer the new name.
    DIGEST_RUN_TOKEN: z.string().min(16).optional(),

    // ── Machine-triggered runners (/internal/**) ────────────────────────────
    // Bearer token for every POST /internal/*/run endpoint. Unset leaves them
    // disabled — an unauthenticated trigger would let anyone drain a queue.
    INTERNAL_RUN_TOKEN: z.string().min(16).optional(),

    // ── Outbound webhooks ───────────────────────────────────────────────────
    // Same trade-off as the digest ticker: on for the long-lived container,
    // off where an external scheduler owns the cadence. The runner claims its
    // work in the database, so both triggers may be active at once.
    WEBHOOK_SCHEDULER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // Webhooks are near-real-time by expectation, so this ticks far more often
    // than the digest runner. Each tick is one indexed query when idle.
    WEBHOOK_TICK_SECONDS: z.coerce.number().int().min(5).default(30),
    // Per-request ceiling. A receiver that accepts the connection and then
    // stalls must not hold the batch — this is what bounds a run's worst case.
    WEBHOOK_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    // Attempts before a delivery is given up on as `failed`. The backoff starts
    // at a minute and doubles, so the default spans a good half hour.
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
    // On a multi-tenant instance an org admin pointing a webhook at
    // `http://localhost:5432` or a cloud metadata IP is a privilege escalation,
    // so private, loopback and link-local targets are refused by default. Turn
    // this on for a single-tenant install whose receiver (n8n, a compose
    // sidecar) genuinely lives on the internal network.
    WEBHOOK_ALLOW_PRIVATE_HOSTS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

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
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

/**
 * The shared secret guarding the `/internal` runner endpoints.
 *
 * The token was originally digest-specific (`DIGEST_RUN_TOKEN`), which stopped
 * fitting once a second runner needed the same door. The new name wins where
 * both are set; the old one keeps working so an existing deployment's scheduler
 * does not start getting 401s after an update.
 */
export const internalRunToken: string | undefined = env.INTERNAL_RUN_TOKEN ?? env.DIGEST_RUN_TOKEN;
