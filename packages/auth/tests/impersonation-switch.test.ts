import { describe, expect, it, vi } from "vitest";

// The kill-switch is read from the validated env at call time, and `createEnv`
// freezes its values at module load — so the switch has to be flipped here.
vi.mock("@nilovon-wiki/env/server", () => ({
  env: { IMPERSONATION_ENABLED: false, IMPERSONATION_MAX_MINUTES: 30 },
}));

import type { Database } from "@nilovon-wiki/db";

import { adminAuditPlugin } from "../src/admin-hooks";

const plugin = adminAuditPlugin({} as Database);

/** Finds the hook whose matcher claims `path`. */
function hookFor(hooks: typeof plugin.hooks.before, path: string) {
  return hooks.find((hook) => hook.matcher({ path } as never));
}

describe("impersonation kill-switch", () => {
  it("rejects impersonation server-side when the operator disabled it", async () => {
    const hook = hookFor(plugin.hooks.before, "/admin/impersonate-user");
    expect(hook).toBeDefined();

    // Hiding the button is not the control: a request straight to the auth
    // endpoint has to be refused too.
    await expect(hook!.handler({ path: "/admin/impersonate-user" } as never)).rejects.toMatchObject(
      { status: "FORBIDDEN" },
    );
  });

  it("leaves the other admin endpoints alone", () => {
    const hook = hookFor(plugin.hooks.before, "/admin/ban-user");
    // Only the pre-state capture matches ban-user; the switch must not.
    expect(hook).toBeUndefined();
  });
});

describe("audited endpoints", () => {
  const after = plugin.hooks.after[0]!;

  it.each([
    "/admin/create-user",
    "/admin/set-role",
    "/admin/ban-user",
    "/admin/unban-user",
    "/admin/remove-user",
    "/admin/set-user-password",
    "/admin/revoke-user-session",
    "/admin/revoke-user-sessions",
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
  ])("logs %s", (path) => {
    expect(after.matcher({ path } as never)).toBe(true);
  });

  it("ignores reads and unrelated endpoints", () => {
    expect(after.matcher({ path: "/admin/list-users" } as never)).toBe(false);
    expect(after.matcher({ path: "/sign-in/email" } as never)).toBe(false);
    expect(after.matcher({} as never)).toBe(false);
  });

  it("captures pre-state exactly where the handler destroys its own evidence", () => {
    const before = plugin.hooks.before[1]!;
    for (const path of [
      "/admin/remove-user",
      "/admin/revoke-user-session",
      "/admin/stop-impersonating",
    ]) {
      expect(before.matcher({ path } as never)).toBe(true);
    }
    // ban-user's response still names the target, so no pre-state is needed.
    expect(before.matcher({ path: "/admin/ban-user" } as never)).toBe(false);
  });
});
