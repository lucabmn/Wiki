import { describe, expect, it } from "vitest";

import { PageSchema, PaginationInputSchema } from "../../src/schemas/shared";
import { z } from "zod";

describe("PaginationInputSchema", () => {
  it("defaults the limit to 25", () => {
    expect(PaginationInputSchema.parse({}).limit).toBe(25);
  });

  it("coerces a numeric string limit", () => {
    expect(PaginationInputSchema.parse({ limit: "10" }).limit).toBe(10);
  });

  it("rejects a limit outside 1..100", () => {
    expect(PaginationInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(PaginationInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe("PageSchema envelope", () => {
  it("wraps items and a nullable cursor", () => {
    const schema = PageSchema(z.string());
    expect(schema.safeParse({ items: ["a", "b"], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse({ items: ["a"], nextCursor: "tok" }).success).toBe(true);
    expect(schema.safeParse({ items: "nope", nextCursor: null }).success).toBe(false);
  });
});
