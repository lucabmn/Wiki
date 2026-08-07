import { afterEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";

import {
  emailDomain,
  isDomainAllowed,
  parseAllowedDomains,
  refuseSignupReason,
} from "../src/signup-policy";

/**
 * `env` is the validated object the module reads at call time, so overriding a
 * field for one test and restoring it afterwards is enough — no module reset,
 * and no second copy of the schema to keep in sync.
 */
const overrides: Array<() => void> = [];
function setEnv<K extends keyof typeof env>(key: K, value: (typeof env)[K]): void {
  const previous = env[key];
  (env as Record<string, unknown>)[key as string] = value;
  overrides.push(() => {
    (env as Record<string, unknown>)[key as string] = previous;
  });
}

afterEach(() => {
  while (overrides.length) overrides.pop()?.();
  vi.restoreAllMocks();
});

/** A database stand-in whose invitation lookup answers `rows`. */
function dbWithInvitations(rows: Array<{ id: string }>): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Database;
}

describe("allowed-domain parsing", () => {
  it("accepts the three spellings operators actually write", () => {
    expect(parseAllowedDomains("example.com, example.org")).toEqual(["example.com", "example.org"]);
    expect(parseAllowedDomains("@example.com")).toEqual(["example.com"]);
    expect(parseAllowedDomains("Example.COM\n.example.org")).toEqual([
      "example.com",
      "example.org",
    ]);
  });

  it("treats an unset or empty list as no restriction", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains("  ")).toEqual([]);
    expect(isDomainAllowed("anyone@anywhere.test", [])).toBe(true);
  });

  it("matches the domain exactly, not as a suffix", () => {
    expect(emailDomain("Person@Example.COM")).toBe("example.com");
    expect(isDomainAllowed("person@example.com", ["example.com"])).toBe(true);
    // A subdomain is a different mail domain, and `evil-example.com` is a
    // different organization entirely — neither may slip through.
    expect(isDomainAllowed("person@sub.example.com", ["example.com"])).toBe(false);
    expect(isDomainAllowed("person@evil-example.com", ["example.com"])).toBe(false);
  });

  it("refuses anything that is not an address", () => {
    expect(isDomainAllowed("not-an-address", ["example.com"])).toBe(false);
  });
});

describe("registration policy", () => {
  it("lets anyone register while the mode is open", async () => {
    setEnv("SIGNUP_MODE", "open");
    expect(await refuseSignupReason(dbWithInvitations([]), "someone@anywhere.test")).toBeNull();
  });

  it("refuses everyone while the mode is closed", async () => {
    setEnv("SIGNUP_MODE", "closed");
    expect(await refuseSignupReason(dbWithInvitations([]), "someone@anywhere.test")).toMatch(
      /deaktiviert/,
    );
  });

  it("still admits INITIAL_ADMIN_EMAIL while closed", async () => {
    // Without this exemption a fresh instance configured as `closed` could
    // never be bootstrapped: no account, therefore no admin to reopen it.
    setEnv("SIGNUP_MODE", "closed");
    setEnv("INITIAL_ADMIN_EMAIL", "Owner@Example.com");
    expect(await refuseSignupReason(dbWithInvitations([]), "owner@example.com")).toBeNull();
  });

  it("admits only invited addresses in invite mode", async () => {
    setEnv("SIGNUP_MODE", "invite");
    expect(
      await refuseSignupReason(dbWithInvitations([{ id: "i1" }]), "invited@x.test"),
    ).toBeNull();
    expect(await refuseSignupReason(dbWithInvitations([]), "stranger@x.test")).toMatch(/Einladung/);
  });

  it("applies the domain allowlist on top of an open mode", async () => {
    setEnv("SIGNUP_MODE", "open");
    setEnv("SIGNUP_ALLOWED_EMAIL_DOMAINS", "example.com");
    expect(await refuseSignupReason(dbWithInvitations([]), "person@example.com")).toBeNull();
    expect(await refuseSignupReason(dbWithInvitations([]), "person@other.test")).toMatch(/Domain/);
  });

  it("checks the domain before the mode, so the message names the real reason", async () => {
    // Both would refuse, but "your domain is not allowed" is actionable and
    // "registration is closed" is not — someone at the wrong domain would
    // otherwise ask an admin to reopen an instance that is already open.
    setEnv("SIGNUP_MODE", "closed");
    setEnv("SIGNUP_ALLOWED_EMAIL_DOMAINS", "example.com");
    expect(await refuseSignupReason(dbWithInvitations([]), "person@other.test")).toMatch(/Domain/);
  });
});
