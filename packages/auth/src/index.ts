import { createDb } from "@nilovon-wiki/db";
import * as schema from "@nilovon-wiki/db/schema/auth";
import { env } from "@nilovon-wiki/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { actionMail, sendMail } from "./mail";
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
    databaseHooks: {
      session: {
        create: {
          // Stamp the active org onto the session *row at creation*, before the
          // session cookie (and its 5-minute cache) is signed. Setting it later
          // — e.g. the SSR middleware calling `organization.setActive` — updates
          // the database but not the browser's cached session, so API calls kept
          // seeing `activeOrganizationId: null` until the cache expired.
          before: async (session) => {
            const membership = await db.query.member.findFirst({
              columns: { organizationId: true },
              where: (member, { eq }) => eq(member.userId, session.userId),
              orderBy: (member, { asc }) => asc(member.createdAt),
            });

            if (!membership) return;

            return { data: { activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: `${env.APP_NAME}: Passwort zurücksetzen`,
          ...actionMail({
            heading: "Passwort zurücksetzen",
            body: `Für ${user.email} wurde ein neues Passwort angefordert. Der Link ist eine Stunde gültig. Wenn du das nicht warst, ignoriere diese E-Mail.`,
            actionLabel: "Neues Passwort setzen",
            url,
          }),
        });
      },
    },
    // Verification is wired but not required: enforcing it on a self-host with
    // no SMTP configured would lock every new account out. Operators who set
    // SMTP_HOST can turn on `requireEmailVerification` above.
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: `${env.APP_NAME}: E-Mail-Adresse bestätigen`,
          ...actionMail({
            heading: "E-Mail-Adresse bestätigen",
            body: `Bestätige ${user.email}, um dein Konto vollständig zu aktivieren.`,
            actionLabel: "Adresse bestätigen",
            url,
          }),
        });
      },
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
        // The invitation id is the whole handshake: the accept route reads it
        // from the path and calls `organization.acceptInvitation`. CORS_ORIGIN
        // is the web app's own origin, which is where that route lives.
        sendInvitationEmail: async ({ id, email, inviter, organization: org }) => {
          await sendMail({
            to: email,
            subject: `${inviter.user.name} lädt dich zu ${org.name} ein`,
            ...actionMail({
              heading: `Einladung zu ${org.name}`,
              body: `${inviter.user.name} (${inviter.user.email}) hat dich in den Wissens-Hub ${org.name} eingeladen.`,
              actionLabel: "Einladung annehmen",
              url: new URL(`/accept-invitation/${id}`, env.CORS_ORIGIN).toString(),
            }),
          });
        },
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
