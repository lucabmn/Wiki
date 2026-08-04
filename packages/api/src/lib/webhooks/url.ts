import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { env } from "@nilovon-wiki/env/server";

/**
 * Where a webhook is allowed to point.
 *
 * On a multi-tenant instance the endpoint URL is attacker-controlled input from
 * the *server's* perspective: an org admin who may not reach the database host
 * can still make this process POST to it and read the outcome back from the
 * delivery log (SSRF). Cloud metadata endpoints (`169.254.169.254`) are the
 * classic escalation.
 *
 * So the target is checked twice. Once at save time, on the literal hostname, so
 * the admin gets an error in the dialog rather than a mysterious failed
 * delivery. Once again in the runner, on the *resolved* addresses, because
 * `evil.example.com` may resolve to `127.0.0.1` and the hostname alone proves
 * nothing.
 *
 * Residual risk, stated plainly: between our resolution and `fetch`'s own, a
 * hostile DNS server can hand out a different answer (rebinding). Closing that
 * would mean connecting to a pinned IP while keeping the TLS SNI and `Host`
 * header intact, which `fetch` does not expose. The two checks raise the bar and
 * are honest about not being a sandbox — an install that treats org admins as
 * hostile should also isolate the container's egress.
 */

/** Hostnames that never leave the machine, regardless of DNS. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

/** Suffixes reserved for internal naming (RFC 6762, RFC 8375, cloud defaults). */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

export type UrlCheck = { ok: true } | { ok: false; reason: string };

const OK: UrlCheck = { ok: true };

/**
 * Literal-hostname check, safe to run inside a request handler: no DNS, so it
 * cannot be used to stall a mutation or to probe the network by timing.
 */
export function checkWebhookHostname(rawUrl: string): UrlCheck {
  if (env.WEBHOOK_ALLOW_PRIVATE_HOSTS) return OK;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Die URL konnte nicht gelesen werden." };
  }

  // IPv6 literals arrive bracketed (`http://[::1]/`); `hostname` keeps the
  // brackets, and `isIP` does not accept them.
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: `„${url.hostname}" liegt im internen Netz.` };
  }
  if (isIP(hostname) && isBlockedAddress(hostname)) {
    return { ok: false, reason: `Die Adresse ${url.hostname} liegt im internen Netz.` };
  }
  return OK;
}

/**
 * Resolution-time check. Every address the hostname resolves to must be public —
 * a host with one public and one loopback record is rejected, because we cannot
 * control which one `fetch` picks.
 */
export async function checkWebhookTarget(rawUrl: string): Promise<UrlCheck> {
  const literal = checkWebhookHostname(rawUrl);
  if (!literal.ok || env.WEBHOOK_ALLOW_PRIVATE_HOSTS) return literal;

  const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return OK; // already checked above, and nothing to resolve

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: `Der Host „${hostname}" ist nicht auflösbar.` };
  }
  const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
  if (blocked) {
    return { ok: false, reason: `„${hostname}" zeigt auf die interne Adresse ${blocked.address}.` };
  }
  return OK;
}

/**
 * True for anything that is not a public unicast address: loopback, private and
 * shared ranges, link-local (which carries the cloud metadata service),
 * multicast, and the reserved blocks.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(address);
  // Not an address at all — the caller checked the hostname separately.
  return false;
}

function isBlockedIPv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedIPv6(address: string): boolean {
  // Zone index (`fe80::1%eth0`) is routing information, not part of the address.
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;

  // An IPv4-mapped address (`::ffff:127.0.0.1`) reaches the IPv4 stack, so it
  // has to be judged by IPv4 rules or the loopback block is trivially bypassed.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);

  const head = normalized.split(":")[0] ?? "";
  if (/^f[cd]/.test(head)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
  if (head.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
}
