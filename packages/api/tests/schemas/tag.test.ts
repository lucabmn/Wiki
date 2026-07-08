import { describe, expect, it } from "vitest";

import { CreateTagInputSchema, UpdateTagInputSchema } from "../../src/schemas/tag";

describe("CreateTagInputSchema", () => {
  it("requires spaceId and a name within bounds", () => {
    expect(CreateTagInputSchema.safeParse({ spaceId: "s", name: "" }).success).toBe(false);
    expect(CreateTagInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(CreateTagInputSchema.safeParse({ spaceId: "s", name: "urgent" }).success).toBe(true);
    expect(CreateTagInputSchema.safeParse({ spaceId: "s", name: "x".repeat(61) }).success).toBe(
      false,
    );
  });

  it("validates the color as hex when present", () => {
    expect(CreateTagInputSchema.safeParse({ spaceId: "s", name: "x", color: "#0af" }).success).toBe(
      true,
    );
    expect(CreateTagInputSchema.safeParse({ spaceId: "s", name: "x", color: "blue" }).success).toBe(
      false,
    );
  });
});

describe("UpdateTagInputSchema", () => {
  it("requires an id", () => {
    expect(UpdateTagInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(UpdateTagInputSchema.safeParse({ id: "t", name: "x" }).success).toBe(true);
  });
});
