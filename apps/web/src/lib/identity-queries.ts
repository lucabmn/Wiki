// TanStack Query wiring for the enterprise identity surfaces — SSO providers
// and SCIM directory connections. Both live entirely inside Better Auth (the
// plugins own their tables and their authorization), so like `org-queries` these
// wrap `authClient` rather than the oRPC router.

import { useQueryClient } from "@tanstack/react-query";

import { AUTH_BASE_URL, authClient } from "./auth-client";

export const SSO_PROVIDERS_KEY = ["identity", "ssoProviders"] as const;
export const SCIM_CONNECTIONS_KEY = ["identity", "scimConnections"] as const;

/**
 * An SSO provider as the server hands it out.
 *
 * This is deliberately *not* the stored row: `/sso/providers` returns a masked
 * projection — the client secret is dropped and the client id is reduced to its
 * last four characters. Nothing here is sensitive, and nothing here is enough to
 * reconstruct the connection, which is why the edit dialog asks for the secret
 * again instead of pre-filling it.
 */
export type SSOProvider = {
  providerId: string;
  type: "oidc" | "saml";
  issuer: string;
  /** One or more e-mail domains, comma-separated. */
  domain: string;
  organizationId: string | null;
  domainVerified: boolean;
  oidcConfig?: {
    discoveryEndpoint?: string;
    /** Masked, e.g. `****a1b2`. */
    clientIdLastFour?: string;
    pkce?: boolean;
    scopes?: string[];
  };
};

/** A directory-sync connection. The bearer token is never part of this. */
export type SCIMConnection = {
  id: string;
  providerId: string;
  organizationId: string | null;
};

/**
 * Await a Better Auth client call and surface its error as a thrown one, so
 * TanStack Query sees a rejection instead of a `{ data: null }` success.
 *
 * The payload is cast rather than inferred: the client derives its response
 * types from the plugin's OpenAPI metadata, which widens the unions this file
 * declares (`type` comes back as `string`, not `"oidc" | "saml"`). Same reason
 * `org-queries` casts `listRoles`.
 */
async function unwrap<T>(
  call: Promise<{ data: unknown; error: { message?: string } | null }>,
): Promise<T> {
  const result = await call;
  if (result.error) throw new Error(result.error.message ?? "Anfrage fehlgeschlagen");
  return result.data as T;
}

/**
 * Both list endpoints answer with everything the *caller* may see, which spans
 * every organization they administrate plus any provider they registered
 * personally. A settings page belongs to one organization, so scoping happens
 * here — otherwise an admin of two organizations would manage both from either
 * one's settings.
 */
function scopedToOrganization<T extends { organizationId: string | null }>(
  entries: T[],
  organizationId: string,
): T[] {
  return entries.filter((entry) => entry.organizationId === organizationId);
}

export function ssoProvidersQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...SSO_PROVIDERS_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { providers } = await unwrap<{ providers: SSOProvider[] }>(authClient.sso.providers());
      return scopedToOrganization(providers, organizationId as string);
    },
  };
}

export function scimConnectionsQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...SCIM_CONNECTIONS_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { providers } = await unwrap<{ providers: SCIMConnection[] }>(
        authClient.scim.listProviderConnections(),
      );
      return scopedToOrganization(providers, organizationId as string);
    },
  };
}

/** Refresh both identity lists. Call in every mutation's `onSuccess`. */
export function useIdentityRefresh() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SSO_PROVIDERS_KEY }),
      queryClient.invalidateQueries({ queryKey: SCIM_CONNECTIONS_KEY }),
    ]);
  };
}

/**
 * The OIDC redirect URI (a.k.a. callback URL) for a provider id — the value the
 * operator registers in their identity provider.
 *
 * Mirrors the server's own `getOIDCRedirectURI`. It is computed rather than read
 * back because the operator needs it *before* the provider exists: an IdP will
 * not issue a client id until it knows where to redirect.
 */
export function ssoRedirectURI(providerId: string): string {
  return `${AUTH_BASE_URL}/sso/callback/${encodeURIComponent(providerId)}`;
}

/** Base URL an identity provider points its SCIM 2.0 client at. */
export const SCIM_BASE_URL = `${AUTH_BASE_URL}/scim/v2`;

/** The individual domains of a provider's comma-separated `domain` field. */
export function splitDomains(domain: string): string[] {
  return domain
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
