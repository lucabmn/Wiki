// The one value the SSO domain check depends on from both sides.
//
// Must stay server-free: imported by `@nilovon-wiki/auth` (to configure the
// plugin) *and* by the browser (to render the DNS record the operator has to
// publish). Importing db/env/./index here would pull the database into the web
// bundle — same rule as `./permissions`.

/**
 * Prefix of the TXT record name that proves control of an SSO e-mail domain.
 *
 * Better Auth has a default, but it is neither exported nor part of its public
 * API, while the settings UI has to print the exact record name. A silent drift
 * between the two is unobservable from this side — the operator would publish a
 * record the server never queries, and verification would simply never pass. So
 * the value is pinned here and passed to the plugin explicitly.
 */
export const SSO_DOMAIN_TOKEN_PREFIX = "better-auth-token";

/**
 * Full DNS name of that TXT record, e.g.
 * `_better-auth-token-okta.acme.com`. Mirrors the plugin's
 * `getVerificationIdentifier`, which prepends the underscore itself per RFC 8552.
 */
export function ssoDomainRecordName(providerId: string, domain: string): string {
  return `_${SSO_DOMAIN_TOKEN_PREFIX}-${providerId}.${domain}`;
}
