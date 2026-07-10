import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { isUniqueViolation, mapUniqueViolation } from "../../src/lib/pg-errors";

describe("isUniqueViolation", () => {
  it("detects a top-level pg unique violation", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects a violation wrapped in a DrizzleQueryError cause chain", () => {
    const wrapped = Object.assign(new Error("query failed"), { cause: { code: "23505" } });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("ignores other pg errors and non-errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK violation
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("mapUniqueViolation", () => {
  it("passes the result through when nothing throws", async () => {
    await expect(mapUniqueViolation(async () => 42, "nope")).resolves.toBe(42);
  });

  it("remaps a unique violation to a 409 CONFLICT with the given message", async () => {
    await expect(
      mapUniqueViolation(() => Promise.reject({ code: "23505" }), "slug taken"),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "slug taken" });
  });

  it("rethrows unrelated errors unchanged", async () => {
    const other = new ORPCError("BAD_REQUEST", { message: "x" });
    await expect(mapUniqueViolation(() => Promise.reject(other), "slug taken")).rejects.toBe(other);
  });
});
