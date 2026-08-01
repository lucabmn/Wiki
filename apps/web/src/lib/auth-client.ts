import { env } from "@nilovon-wiki/env/web";
import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { scimClient } from "@better-auth/scim/client";
import { ssoClient } from "@better-auth/sso/client";
import { organizationClient } from "better-auth/client/plugins";
import { ac, roles } from "@nilovon-wiki/auth/permissions";

function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

  if (!normalized.startsWith("/")) {
    return normalized;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}${normalized}`;
  }

  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const vercelUrl =
    processEnv?.VERCEL_ENV === "production"
      ? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
      : (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelUrl) {
    const origin = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
    return `${origin}${normalized}`;
  }

  return `http://localhost:3000${normalized}`;
}
/**
 * Public origin of the auth surface, e.g. `https://api.example.com/api/auth`.
 *
 * Exported because SSO and SCIM make the operator paste absolute URLs into a
 * third-party console (the OIDC redirect URI, the SCIM base URL). Those must be
 * the *same* URLs this client talks to, so they are derived here rather than
 * re-assembled per screen.
 */
export const AUTH_BASE_URL = new URL("/api/auth", getServerUrl(env.VITE_SERVER_URL)).toString();

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: AUTH_BASE_URL,
  plugins: [
    adminClient(),
    twoFactorClient(),
    passkeyClient(),
    organizationClient({
      ac,
      roles,
      dynamicAccessControl: {
        enabled: true,
      },
      // Mirrors the server plugin. The client infers its action surface from
      // these options, so without it `organization.createTeam` & friends simply
      // do not exist on the typed client.
      teams: {
        enabled: true,
      },
    }),
    // Must mirror the server's `domainVerification` setting: it is what makes
    // `sso.requestDomainVerification` / `sso.verifyDomain` exist on the typed
    // client at all, and those two are the whole verification flow.
    ssoClient({
      domainVerification: {
        enabled: true,
      },
    }),
    scimClient(),
  ],
});
