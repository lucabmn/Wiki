import { describe, expect, it } from "vitest";

import {
  CreatePageInputSchema,
  ListPagesInputSchema,
  MovePageInputSchema,
  SaveDraftInputSchema,
  UpdatePageInputSchema,
} from "../../src/schemas/page";

describe("CreatePageInputSchema", () => {
  it("applies title/textContent/isTemplate defaults", () => {
    const parsed = CreatePageInputSchema.parse({ spaceId: "space1" });
    expect(parsed.title).toBe("Untitled");
    expect(parsed.textContent).toBe("");
    expect(parsed.isTemplate).toBe(false);
  });

  it("requires a spaceId", () => {
    expect(CreatePageInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an explicit null parentId (space root)", () => {
    expect(CreatePageInputSchema.safeParse({ spaceId: "s", parentId: null }).success).toBe(true);
  });

  it("validates the slug format", () => {
    expect(CreatePageInputSchema.safeParse({ spaceId: "s", slug: "Bad Slug" }).success).toBe(false);
    expect(CreatePageInputSchema.safeParse({ spaceId: "s", slug: "good-slug" }).success).toBe(true);
  });
});

describe("UpdatePageInputSchema", () => {
  it("requires an id", () => {
    expect(UpdatePageInputSchema.safeParse({ title: "x" }).success).toBe(false);
  });
});

describe("MovePageInputSchema", () => {
  it("rejects supplying both beforeId and afterId", () => {
    const r = MovePageInputSchema.safeParse({ id: "p", beforeId: "a", afterId: "b" });
    expect(r.success).toBe(false);
  });

  it("accepts one anchor, or none", () => {
    expect(MovePageInputSchema.safeParse({ id: "p", beforeId: "a" }).success).toBe(true);
    expect(MovePageInputSchema.safeParse({ id: "p", afterId: "b" }).success).toBe(true);
    expect(MovePageInputSchema.safeParse({ id: "p", parentId: null }).success).toBe(true);
  });
});

describe("ListPagesInputSchema", () => {
  it("requires a spaceId and defaults includeArchived to false", () => {
    expect(ListPagesInputSchema.safeParse({}).success).toBe(false);
    expect(ListPagesInputSchema.parse({ spaceId: "s" }).includeArchived).toBe(false);
  });
});

describe("SaveDraftInputSchema", () => {
  it("requires a pageId", () => {
    expect(SaveDraftInputSchema.safeParse({}).success).toBe(false);
    expect(SaveDraftInputSchema.safeParse({ pageId: "p" }).success).toBe(true);
  });
});
