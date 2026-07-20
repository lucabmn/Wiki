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
    NODE_ENV: nodeEnvSchema,
    // Display name used by Better Auth (emails, passkey prompts). Lets
    // self-hosters white-label without patching source.
    APP_NAME: z.string().min(1).default("Nilovon Wiki"),
    // Port the real-time collaboration service (`apps/collab`) listens on.
    COLLAB_PORT: z.coerce.number().int().positive().default(1234),
    // Per-IP request ceilings (requests per minute). The general limit covers
    // /rpc and the REST surface; the auth limit protects /api/auth/* against
    // credential stuffing. Set high enough that normal usage never hits them.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),

    // ── SMTP ────────────────────────────────────────────────────────────────
    // Optional as a whole: with SMTP_HOST unset the app still boots and mail is
    // written to the log instead of sent, so a single-user install needs no
    // mail server. Invitations and password resets only *work* once it is set.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    // Implicit TLS (port 465). Port 587 upgrades via STARTTLS and stays false.
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().min(1).default("Nilovon Wiki <no-reply@localhost>"),

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
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
