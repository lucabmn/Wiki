import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { assertOwnerOrPermission } from "../../src/index";

const headers = new Headers();
const base = {
  headers,
  organizationId: "oA",
  ownerPermissions: [{ comment: ["delete" as const] }, { comment: ["create" as const] }],
  otherPermissions: { comment: ["moderate" as const] },
};

beforeEach(() => {
  hasPermission.mockReset();
});

describe("assertOwnerOrPermission", () => {
  it("requires otherPermissions for a non-owner", async () => {
    hasPermission.mockResolvedValue({ success: true });
    await assertOwnerOrPermission({ ...base, isOwner: false });
    expect(hasPermission).toHaveBeenCalledTimes(1);
    expect(hasPermission).toHaveBeenCalledWith({
      headers,
      body: { permissions: { comment: ["moderate"] }, organizationId: "oA" },
    });
  });

  it("throws FORBIDDEN for a non-owner without the grant", async () => {
    hasPermission.mockResolvedValue({ success: false });
    await expect(assertOwnerOrPermission({ ...base, isOwner: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets the owner through on the first matching grant", async () => {
    hasPermission.mockResolvedValue({ success: true });
    await assertOwnerOrPermission({ ...base, isOwner: true });
    expect(hasPermission).toHaveBeenCalledTimes(1);
    expect(hasPermission).toHaveBeenCalledWith({
      headers,
      body: { permissions: { comment: ["delete"] }, organizationId: "oA" },
    });
  });

  it("falls back to the next owner grant when the first is denied", async () => {
    hasPermission
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    await assertOwnerOrPermission({ ...base, isOwner: true });
    expect(hasPermission).toHaveBeenCalledTimes(2);
    expect(hasPermission).toHaveBeenLastCalledWith({
      headers,
      body: { permissions: { comment: ["create"] }, organizationId: "oA" },
    });
  });

  it("throws FORBIDDEN when the owner holds none of the grants", async () => {
    hasPermission.mockResolvedValue({ success: false });
    await expect(assertOwnerOrPermission({ ...base, isOwner: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(hasPermission).toHaveBeenCalledTimes(2);
  });
});
