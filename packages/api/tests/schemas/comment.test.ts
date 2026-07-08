import { describe, expect, it } from "vitest";

import {
  CreateCommentInputSchema,
  ListCommentsInputSchema,
  UpdateCommentInputSchema,
} from "../../src/schemas/comment";

describe("CreateCommentInputSchema", () => {
  it("requires a non-empty body within the length cap", () => {
    expect(CreateCommentInputSchema.safeParse({ pageId: "p", body: "" }).success).toBe(false);
    expect(CreateCommentInputSchema.safeParse({ pageId: "p", body: "hi" }).success).toBe(true);
    expect(
      CreateCommentInputSchema.safeParse({ pageId: "p", body: "x".repeat(10_001) }).success,
    ).toBe(false);
  });

  it("requires a pageId", () => {
    expect(CreateCommentInputSchema.safeParse({ body: "hi" }).success).toBe(false);
  });
});

describe("UpdateCommentInputSchema", () => {
  it("requires id and body", () => {
    expect(UpdateCommentInputSchema.safeParse({ id: "c" }).success).toBe(false);
    expect(UpdateCommentInputSchema.safeParse({ id: "c", body: "edit" }).success).toBe(true);
  });
});

describe("ListCommentsInputSchema", () => {
  it("defaults includeResolved to true", () => {
    expect(ListCommentsInputSchema.parse({ pageId: "p" }).includeResolved).toBe(true);
  });
});
