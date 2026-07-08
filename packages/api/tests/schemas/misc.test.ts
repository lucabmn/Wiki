import { describe, expect, it } from "vitest";

import { ListActivityInputSchema, SearchInputSchema } from "../../src/schemas/misc";

describe("SearchInputSchema", () => {
  it("requires a non-empty query and defaults the limit to 20", () => {
    expect(SearchInputSchema.safeParse({ query: "" }).success).toBe(false);
    expect(SearchInputSchema.parse({ query: "hello" }).limit).toBe(20);
  });

  it("coerces and caps the limit at 50", () => {
    expect(SearchInputSchema.parse({ query: "x", limit: "5" }).limit).toBe(5);
    expect(SearchInputSchema.safeParse({ query: "x", limit: 51 }).success).toBe(false);
  });
});

describe("ListActivityInputSchema", () => {
  it("defaults the limit to 50", () => {
    expect(ListActivityInputSchema.parse({}).limit).toBe(50);
  });

  it("rejects a limit above 100", () => {
    expect(ListActivityInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
