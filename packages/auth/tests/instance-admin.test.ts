import { beforeEach, describe, expect, it } from "vitest";

import {
  hasInstanceAdminRole,
  splitInstanceRoles,
  withInstanceAdminRole,
} from "../src/instance-admin";
import {
  cachedSessionVersion,
  invalidateCachedSessions,
  resetCachedSessionVersions,
} from "../src/session-revocation";

describe("instance roles", () => {
  it("finds the admin role inside a comma-separated list", () => {
    expect(hasInstanceAdminRole("admin")).toBe(true);
    // Better Auth stores several roles in one column; a `=== "admin"` check
    // would lock these accounts out of the console they are entitled to.
    expect(hasInstanceAdminRole("owner,admin")).toBe(true);
    expect(hasInstanceAdminRole(" user , admin ")).toBe(true);
  });

  it("treats every other value as an ordinary account", () => {
    expect(hasInstanceAdminRole(null)).toBe(false);
    expect(hasInstanceAdminRole("")).toBe(false);
    expect(hasInstanceAdminRole("user")).toBe(false);
    // Not a substring match: "administrator" is a different role name.
    expect(hasInstanceAdminRole("administrator")).toBe(false);
  });

  it("adds the admin role without duplicating or dropping the others", () => {
    expect(withInstanceAdminRole(null)).toBe("admin");
    expect(withInstanceAdminRole("user")).toBe("user,admin");
    expect(withInstanceAdminRole("owner,admin")).toBe("owner,admin");
  });

  it("splits away empty segments", () => {
    expect(splitInstanceRoles("a,,b, ")).toEqual(["a", "b"]);
  });
});

describe("cached session revocation", () => {
  beforeEach(() => resetCachedSessionVersions());

  it("starts every account on the same version", () => {
    expect(cachedSessionVersion("u1")).toBe(cachedSessionVersion("u2"));
  });

  it("changes the version so Better Auth discards the cached cookie", () => {
    const before = cachedSessionVersion("u1");
    invalidateCachedSessions("u1");
    // A different version is what makes `getSession` fall through to the
    // database — where the banned user's session rows no longer exist.
    expect(cachedSessionVersion("u1")).not.toBe(before);
  });

  it("only affects the revoked account", () => {
    const other = cachedSessionVersion("u2");
    invalidateCachedSessions("u1");
    expect(cachedSessionVersion("u2")).toBe(other);
  });

  it("keeps moving on repeated revocations", () => {
    invalidateCachedSessions("u1");
    const first = cachedSessionVersion("u1");
    invalidateCachedSessions("u1");
    expect(cachedSessionVersion("u1")).not.toBe(first);
  });
});
