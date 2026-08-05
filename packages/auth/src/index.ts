import { createDb } from "@nilovon-wiki/db";
import * as schema from "@nilovon-wiki/db/schema/auth";
import { env } from "@nilovon-wiki/env/server";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { adminAuditPlugin } from "./admin-hooks";
import { INSTANCE_ADMIN_ROLES, INSTANCE_ROLE_ADMIN, isInitialAdminEmail } from "./instance-admin";
import { actionMail, sendMail } from "./mail";
import { ac, roles } from "./permissions";
import { cachedSessionVersion } from "./session-revocation";
import { SSO_DOMAIN_TOKEN_PREFIX } from "./sso-domain";
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
        // Without this, a ban or an admin session revocation would not bite for
        // up to those five minutes: `getSession` answers from the signed cookie
        // and never notices the session rows are gone. See session-revocation.ts.
        version: (_session, cachedUser) => cachedSessionVersion(cachedUser.id),
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Bootstraps the very first instance admin. `ensureInitialAdmin` covers
          // the case where the account already exists; this covers the other
          // order — the operator configures the address, then registers.
          before: async (candidate) => {
            if (!isInitialAdminEmail(candidate.email)) return;
            return { data: { ...candidate, role: INSTANCE_ROLE_ADMIN } };
          },
        },
      },
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
    user: {
      changeEmail: {
        enabled: true,
        // Two paths, both needed on a self-host: an account whose address was
        // never verified (the common case here — verification is wired but not
        // required) changes directly, while a verified account must confirm from
        // its *current* inbox so a hijacked session cannot walk off with it.
        updateEmailWithoutVerification: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendMail({
            to: user.email,
            subject: `${env.APP_NAME}: E-Mail-Adresse ändern`,
            ...actionMail({
              heading: "Adressänderung bestätigen",
              body: `Für dein Konto wurde ${newEmail} als neue E-Mail-Adresse angefordert. Bestätige die Änderung, um sie zu übernehmen. Wenn du das nicht warst, ignoriere diese E-Mail — deine Adresse bleibt dann unverändert.`,
              actionLabel: "Änderung bestätigen",
              url,
            }),
          });
        },
      },
    },
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
      // Without this the cookie is host-only on whatever host issued it (the
      // API's). That is enough for the browser's own calls to the API — they
      // are cross-site but carry the cookie via `SameSite=None` + credentials.
      // It is *not* enough for the web app's SSR middleware, which forwards the
      // cookies the browser sent to the *web* host and would never see one
      // scoped to the API host. `domain` must be given explicitly: better-auth
      // otherwise falls back to `baseURL`'s hostname, which re-scopes to the
      // API host and changes nothing.
      ...(env.COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: env.COOKIE_DOMAIN,
            },
          }
        : {}),
      defaultCookieAttributes: {
        sameSite: isHttps ? "none" : "lax",
        secure: isHttps,
        httpOnly: true,
      },
    },
    plugins: [
      // Instance administration. Distinct from the organization roles below:
      // this governs the deployment (accounts, sessions, health), not one
      // tenant's content — see docs/permissions.md.
      admin({
        adminRoles: INSTANCE_ADMIN_ROLES,
        // Short by design. An impersonated session is a support tool, not a
        // second login; a forgotten tab must not stay signed in as somebody
        // else for a working day.
        impersonationSessionDuration: env.IMPERSONATION_MAX_MINUTES * 60,
        bannedUserMessage:
          "Dieses Konto wurde gesperrt. Wende dich an die Administration deiner Instanz.",
      }),
      // Must follow `admin()`: it hooks that plugin's endpoints to write the
      // instance audit log and to enforce the impersonation kill-switch.
      adminAuditPlugin(db),
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
      // Enterprise sign-in. Providers are registered per organization from
      // /settings/sso — never from env — so a self-host can onboard an IdP
      // without a redeploy.
      sso({
        // The domain is what `signIn.sso({ email })` matches on, so an
        // unverified one is a hijacking primitive: an admin of *any*
        // organization could claim `gmail.com` and catch every Gmail address
        // that tries to sign in. Requiring a DNS TXT record first also makes a
        // provider trusted enough to adopt an existing local account instead of
        // creating a second one for the same person.
        //
        // Note for operators: verifying calls `dns.resolveTxt` from this
        // process, so it must be able to resolve the email domain — see
        // docs/sso.md.
        domainVerification: {
          enabled: true,
          // Pinned rather than left to the plugin's default: the settings UI
          // prints the record name from the same constant, and a drift would
          // fail silently — the operator publishes a record nobody queries.
          tokenPrefix: SSO_DOMAIN_TOKEN_PREFIX,
        },
        // A provider belongs to an organization, so signing in through it is
        // also how you join: the IdP owns the member list, and revoking access
        // there is what keeps someone out. New members land as `member`;
        // elevating them stays a deliberate act in /settings/members.
        organizationProvisioning: {
          defaultRole: "member",
        },
      }),
      // Directory sync. The IdP pushes users to /api/auth/scim/v2/* with a
      // bearer token minted in /settings/sso.
      scim({
        // Only the hash is stored, so the token exists in cleartext exactly
        // once: in the dialog that created it. Same contract as the two-factor
        // backup codes.
        storeSCIMToken: "hashed",
        // A SCIM token can create and delete users. This wiki has no use for
        // personal connections: every connection belongs to an organization,
        // where the plugin's owner/admin check applies. In 1.7 this callback
        // runs after that built-in authorization; a null member means personal.
        beforeSCIMTokenGenerated: async ({ member }) => {
          if (!member) {
            throw new APIError("BAD_REQUEST", {
              message: "SCIM-Verbindungen müssen zu einer Organisation gehören",
            });
          }
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
