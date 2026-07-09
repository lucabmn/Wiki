import { createDb } from "@nilovon-wiki/db";
import * as schema from "@nilovon-wiki/db/schema/auth";
import { env } from "@nilovon-wiki/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { ac, roles } from "./permissions";
import { localization } from "better-auth-localization";

export function createAuth() {
  const db = createDb();

  // Browsers only accept `Secure` cookies over HTTPS (localhost is the sole
  // exception), and `SameSite=None` requires `Secure`. Deriving the attributes
  // from the deployment's own URL means: HTTPS deployments get cross-site-safe
  // cookies (web + api on different subdomains), while plain-HTTP setups
  // (localhost, LAN pilots) fall back to `Lax` cookies that actually stick —
  // instead of auth silently failing.
  const isHttps = env.BETTER_AUTH_URL.startsWith("https:");

  return betterAuth({
    appName: env.APP_NAME,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    experimental: {
      joins: true,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // Cache session for 5 minutes
      },
    },
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: isHttps ? "none" : "lax",
        secure: isHttps,
        httpOnly: true,
      },
    },
    plugins: [
      admin(),
      twoFactor(),
      passkey(),
      organization({
        ac,
        roles,
        dynamicAccessControl: {
          enabled: true,
        },
        teams: {
          enabled: true,
        },
      }),
      localization({
        defaultLocale: "de-DE-informal",
        fallbackLocale: "default",
      }),
    ],
  });
}

export const auth = createAuth();
