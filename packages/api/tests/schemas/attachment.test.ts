import { describe, expect, it } from "vitest";

import {
  CreateAttachmentInputSchema,
  ListAttachmentsInputSchema,
} from "../../src/schemas/attachment";

describe("ListAttachmentsInputSchema", () => {
  it("requires at least one of spaceId or pageId", () => {
    expect(ListAttachmentsInputSchema.safeParse({}).success).toBe(false);
    expect(ListAttachmentsInputSchema.safeParse({ spaceId: "s" }).success).toBe(true);
    expect(ListAttachmentsInputSchema.safeParse({ pageId: "p" }).success).toBe(true);
  });
});

describe("CreateAttachmentInputSchema", () => {
  const base = {
    spaceId: "s",
    fileName: "a.png",
    mimeType: "image/png",
    size: 1024,
    storageKey: "k/1",
  };

  it("accepts a complete metadata row", () => {
    expect(CreateAttachmentInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a negative or non-integer size", () => {
    expect(CreateAttachmentInputSchema.safeParse({ ...base, size: -1 }).success).toBe(false);
    expect(CreateAttachmentInputSchema.safeParse({ ...base, size: 1.5 }).success).toBe(false);
  });

  it("requires fileName, mimeType and storageKey", () => {
    expect(CreateAttachmentInputSchema.safeParse({ ...base, fileName: "" }).success).toBe(false);
    expect(CreateAttachmentInputSchema.safeParse({ ...base, storageKey: "" }).success).toBe(false);
  });
});
