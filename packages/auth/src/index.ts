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

  return betterAuth({
    appName: "Nilovon Wiki",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    experimental: {
      joins: true,
    },
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      // `SameSite=None; Secure` supports the cross-site web (:3001) <-> server
      // (:3000) setup, but browsers only accept `Secure` cookies over HTTPS
      // (localhost is the sole exception). When self-hosting, serve the API
      // behind TLS and point BETTER_AUTH_URL/CORS_ORIGIN at https:// URLs, or
      // auth sessions will silently fail.
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
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
