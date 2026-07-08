import { describe, expect, it } from "vitest";

import {
  CreateSpaceInputSchema,
  ListSpacesInputSchema,
  UpdateSpaceInputSchema,
} from "../../src/schemas/space";

describe("CreateSpaceInputSchema", () => {
  it("accepts a minimal payload and defaults visibility to private", () => {
    const parsed = CreateSpaceInputSchema.parse({ name: "Docs" });
    expect(parsed.visibility).toBe("private");
    expect(parsed.slug).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(CreateSpaceInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a non-kebab slug but accepts a valid one", () => {
    expect(CreateSpaceInputSchema.safeParse({ name: "x", slug: "Not Kebab" }).success).toBe(false);
    expect(CreateSpaceInputSchema.safeParse({ name: "x", slug: "my-space-2" }).success).toBe(true);
  });

  it("validates the color as a hex code", () => {
    expect(CreateSpaceInputSchema.safeParse({ name: "x", color: "#fff" }).success).toBe(true);
    expect(CreateSpaceInputSchema.safeParse({ name: "x", color: "#abcdef" }).success).toBe(true);
    expect(CreateSpaceInputSchema.safeParse({ name: "x", color: "red" }).success).toBe(false);
  });

  it("rejects an unknown visibility", () => {
    expect(CreateSpaceInputSchema.safeParse({ name: "x", visibility: "secret" }).success).toBe(
      false,
    );
  });
});

describe("UpdateSpaceInputSchema", () => {
  it("requires an id", () => {
    expect(UpdateSpaceInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(UpdateSpaceInputSchema.safeParse({ id: "abc", name: "x" }).success).toBe(true);
  });
});

describe("ListSpacesInputSchema", () => {
  it("defaults includeArchived to false", () => {
    expect(ListSpacesInputSchema.parse({}).includeArchived).toBe(false);
  });
});
