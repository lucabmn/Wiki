import { appendFile, readFile, writeFile } from "node:fs/promises";
import { envPath } from "./paths";
import { generatePassword, generateSecret } from "./secrets";

/**
 * The values a fresh self-hosted install needs. Secrets are generated up-front
 * (see {@link defaultConfig}); the operator only has to confirm or override URLs
 * and, if they want, the generated passwords.
 */
export interface InstallConfig {
  /** Public base URL of the API server (apps/server). */
  serverUrl: string;
  /** Public origin of the web app (apps/web) — also the CORS origin. */
  webUrl: string;
  /** WebSocket origin of the collab service, browser-reachable. */
  collabUrl: string;
  /** Let's-Encrypt contact email — required for https installs (Caddy). */
  acmeEmail: string;
  /** Postgres superuser password (compose interpolates POSTGRES_PASSWORD). */
  postgresPassword: string;
  /** Better Auth signing secret, shared by server + collab (min 32 chars). */
  authSecret: string;
  /** Access-key identifier for the bundled S3-compatible object store. */
  s3AccessKeyId: string;
  /** Secret key for the bundled S3-compatible object store. */
  s3SecretAccessKey: string;
}

export function defaultConfig(): InstallConfig {
  return {
    serverUrl: "http://localhost:3000",
    webUrl: "http://localhost:3001",
    collabUrl: "ws://localhost:1234",
    acmeEmail: "",
    postgresPassword: generatePassword(),
    authSecret: generateSecret(),
    s3AccessKeyId: generatePassword(16),
    s3SecretAccessKey: generateSecret(),
  };
}

/**
 * An install is "production" when the web app is served over https. In that
 * mode the stack comes up with the Caddy TLS overlay (docker-compose.prod.yml)
 * and the domain variables below are written for it.
 */
export function isProduction(config: Pick<InstallConfig, "webUrl">): boolean {
  return config.webUrl.startsWith("https:");
}

// ── Editable form fields ────────────────────────────────────────────────────
// Secrets are marked so the UI can mask them and offer a "regenerate" action.
export interface FieldDef {
  key: keyof InstallConfig;
  label: string;
  help: string;
  secret?: boolean;
}

export const fields: FieldDef[] = [
  { key: "serverUrl", label: "Server-URL", help: "Öffentliche URL der API (apps/server)" },
  { key: "webUrl", label: "Web-URL", help: "Öffentliche URL der Web-App (auch CORS-Origin)" },
  { key: "collabUrl", label: "Collab-URL", help: "WebSocket-Origin des Echtzeit-Dienstes" },
  {
    key: "acmeEmail",
    label: "TLS-E-Mail",
    help: "Let's-Encrypt-Kontakt — nur bei https-URLs nötig, sonst leer lassen",
  },
  {
    key: "postgresPassword",
    label: "DB-Passwort",
    help: "Postgres-Passwort (automatisch generiert)",
    secret: true,
  },
  {
    key: "authSecret",
    label: "Auth-Secret",
    help: "Better-Auth Signatur-Secret (automatisch generiert)",
    secret: true,
  },
  {
    key: "s3AccessKeyId",
    label: "S3-Zugriff",
    help: "Zugriffsschlüssel für den Attachment-Speicher (automatisch generiert)",
    secret: true,
  },
  {
    key: "s3SecretAccessKey",
    label: "S3-Secret",
    help: "Geheimer Schlüssel für den Attachment-Speicher (automatisch generiert)",
    secret: true,
  },
];

// ── Validation ──────────────────────────────────────────────────────────────
export type FieldErrors = Partial<Record<keyof InstallConfig, string>>;

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isWsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "ws:" || u.protocol === "wss:";
  } catch {
    return false;
  }
}

export function validate(config: Partial<InstallConfig>): FieldErrors {
  const errors: FieldErrors = {};
  if (!isHttpUrl(config.serverUrl ?? "")) errors.serverUrl = "muss eine http(s)-URL sein";
  if (!isHttpUrl(config.webUrl ?? "")) errors.webUrl = "muss eine http(s)-URL sein";
  if (!isWsUrl(config.collabUrl ?? "")) errors.collabUrl = "muss eine ws(s)-URL sein";
  if ((config.postgresPassword ?? "").trim().length < 8)
    errors.postgresPassword = "mindestens 8 Zeichen";
  if ((config.authSecret ?? "").length < 32) errors.authSecret = "mindestens 32 Zeichen";
  if ((config.s3AccessKeyId ?? "").length < 16) errors.s3AccessKeyId = "mindestens 16 Zeichen";
  if ((config.s3SecretAccessKey ?? "").length < 32)
    errors.s3SecretAccessKey = "mindestens 32 Zeichen";

  // TLS terminates at Caddy for all three services at once — mixed http/https
  // configs produce broken cookies or blocked WebSockets, so refuse them.
  const secure = [
    config.webUrl?.startsWith("https:"),
    config.serverUrl?.startsWith("https:"),
    config.collabUrl?.startsWith("wss:"),
  ];
  if (secure.some(Boolean) && !secure.every(Boolean)) {
    if (!errors.webUrl && !config.webUrl?.startsWith("https:"))
      errors.webUrl = "https nötig, wenn andere URLs https/wss sind";
    if (!errors.serverUrl && !config.serverUrl?.startsWith("https:"))
      errors.serverUrl = "https nötig, wenn andere URLs https/wss sind";
    if (!errors.collabUrl && !config.collabUrl?.startsWith("wss:"))
      errors.collabUrl = "wss nötig, wenn andere URLs https/wss sind";
  }
  if (secure.every(Boolean) && !/.+@.+\..+/.test(config.acmeEmail ?? ""))
    errors.acmeEmail = "gültige E-Mail nötig (Let's Encrypt)";

  return errors;
}

/** True when the config passes validation (no field errors). */
export function isValid(config: InstallConfig): boolean {
  return Object.keys(validate(config)).length === 0;
}

// ── Env file rendering ──────────────────────────────────────────────────────
export interface EnvFile {
  /** Human label for the review screen. */
  label: string;
  /** Path relative to the repo root. */
  rel: string;
  content: string;
}

function kv(pairs: Record<string, string>): string {
  return (
    Object.entries(pairs)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

/**
 * The set of `.env` files docker compose reads, materialised from a config.
 *
 * Note: compose overrides `DATABASE_URL` for the server/collab containers with a
 * value pointing at the `postgres` service, so the DATABASE_URL written here is
 * the same docker-internal DSN for consistency (and for non-container runs).
 */
export function renderEnvFiles(config: InstallConfig): EnvFile[] {
  const databaseUrl = `postgresql://postgres:${config.postgresPassword}@postgres:5432/nilovon-wiki`;
  const isLocal = config.serverUrl.startsWith("http://localhost");
  const production = isProduction(config);

  return [
    {
      label: "Root (Compose-Variablen)",
      rel: ".env",
      // The root .env is the canonical config for compose: it interpolates the
      // secrets and URLs into every container (see docker-compose.yml). The
      // VITE_* vars feed the web image's build args so a rebuild targets the
      // real domain instead of localhost. In production mode the domain vars
      // additionally feed the Caddy TLS overlay (docker-compose.prod.yml).
      content: kv({
        POSTGRES_PASSWORD: config.postgresPassword,
        BETTER_AUTH_SECRET: config.authSecret,
        BETTER_AUTH_URL: config.serverUrl,
        CORS_ORIGIN: config.webUrl,
        VITE_SERVER_URL: config.serverUrl,
        VITE_COLLAB_URL: config.collabUrl,
        S3_ACCESS_KEY_ID: config.s3AccessKeyId,
        S3_SECRET_ACCESS_KEY: config.s3SecretAccessKey,
        S3_BUCKET: "nilovon-wiki",
        S3_ENDPOINT: "http://rustfs:9000",
        S3_REGION: "us-east-1",
        S3_FORCE_PATH_STYLE: "true",
        ...(production
          ? {
              WEB_DOMAIN: new URL(config.webUrl).hostname,
              API_DOMAIN: new URL(config.serverUrl).hostname,
              COLLAB_DOMAIN: new URL(config.collabUrl).hostname,
              ACME_EMAIL: config.acmeEmail,
            }
          : {}),
      }),
    },
    {
      label: "Server",
      rel: "apps/server/.env",
      content: kv({
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: config.authSecret,
        BETTER_AUTH_URL: config.serverUrl,
        CORS_ORIGIN: config.webUrl,
        NODE_ENV: isLocal ? "development" : "production",
        COLLAB_PORT: "1234",
        S3_ACCESS_KEY_ID: config.s3AccessKeyId,
        S3_SECRET_ACCESS_KEY: config.s3SecretAccessKey,
        S3_BUCKET: "nilovon-wiki",
        S3_ENDPOINT: "http://rustfs:9000",
        S3_REGION: "us-east-1",
        S3_FORCE_PATH_STYLE: "true",
      }),
    },
    {
      label: "Collab",
      rel: "apps/collab/.env",
      content: kv({
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: config.authSecret,
        BETTER_AUTH_URL: config.serverUrl,
        CORS_ORIGIN: config.webUrl,
        COLLAB_PORT: "1234",
      }),
    },
    {
      label: "Web",
      rel: "apps/web/.env",
      content: kv({
        VITE_SERVER_URL: config.serverUrl,
        VITE_COLLAB_URL: config.collabUrl,
      }),
    },
  ];
}

/**
 * Add credentials required by the bundled object store to a legacy root env.
 * Appending preserves optional SMTP/custom-S3 settings that the installer does
 * not model and avoids silently rewriting a live installation.
 */
export async function ensureStorageCredentials(): Promise<boolean> {
  const root = await readEnv(".env");
  if (root.S3_ACCESS_KEY_ID && root.S3_SECRET_ACCESS_KEY) return false;
  const accessKey = root.S3_ACCESS_KEY_ID || generatePassword(16);
  const secretKey = root.S3_SECRET_ACCESS_KEY || generateSecret();
  const additions = [
    root.S3_ACCESS_KEY_ID ? null : `S3_ACCESS_KEY_ID=${accessKey}`,
    root.S3_SECRET_ACCESS_KEY ? null : `S3_SECRET_ACCESS_KEY=${secretKey}`,
  ].filter((line): line is string => line !== null);
  await appendFile(
    envPath(".env"),
    `\n# Added by the v1 storage credential migration\n${additions.join("\n")}\n`,
    "utf8",
  );
  return true;
}

/** Write all env files to disk. Returns the relative paths written. */
export async function writeEnvFiles(config: InstallConfig): Promise<string[]> {
  const files = renderEnvFiles(config);
  await Promise.all(files.map((f) => writeFile(envPath(f.rel), f.content, "utf8")));
  return files.map((f) => f.rel);
}

// ── Reading existing config back ────────────────────────────────────────────
/** Parse `KEY=value` lines (ignoring comments/blanks) into a record. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

async function readEnv(rel: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(envPath(rel), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Reconstruct an {@link InstallConfig} from the `.env` files on disk.
 *
 * URLs fall back to sane defaults when absent (harmless). Secrets do NOT: a
 * missing database/auth/storage credentials yield an empty string, not
 * a freshly-minted value. Inventing a secret here would let the config editor
 * silently overwrite a live install's working credentials — instead the empty
 * value fails {@link validate}, which the editor surfaces as "run Install first"
 * and refuses to save.
 */
export async function readConfig(): Promise<InstallConfig> {
  const [server, web, root] = await Promise.all([
    readEnv("apps/server/.env"),
    readEnv("apps/web/.env"),
    readEnv(".env"),
  ]);
  const d = defaultConfig();
  return {
    serverUrl: server.BETTER_AUTH_URL ?? root.BETTER_AUTH_URL ?? d.serverUrl,
    webUrl: server.CORS_ORIGIN ?? root.CORS_ORIGIN ?? d.webUrl,
    collabUrl: web.VITE_COLLAB_URL ?? root.VITE_COLLAB_URL ?? d.collabUrl,
    acmeEmail: root.ACME_EMAIL ?? "",
    postgresPassword: root.POSTGRES_PASSWORD ?? "",
    authSecret: server.BETTER_AUTH_SECRET ?? root.BETTER_AUTH_SECRET ?? "",
    s3AccessKeyId: server.S3_ACCESS_KEY_ID ?? root.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: server.S3_SECRET_ACCESS_KEY ?? root.S3_SECRET_ACCESS_KEY ?? "",
  };
}
