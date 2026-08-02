import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  scimGroup,
  scimGroupMember,
  scimGroupRole,
  scimGroupRoleGrant,
  scimProvider,
  ssoProvider,
} from "@nilovon-wiki/db/schema/auth";

import { auth } from "../src/index";

// Better Auth's plugins declare the tables they need, but this repo writes the
// Drizzle schema by hand (`pnpm auth:generate` would flatten the curated indexes
// and `relations()` blocks in packages/db/src/schema/auth.ts). Nothing enforces
// that the two agree: a field the plugin expects but the table lacks compiles
// fine and only fails when an admin actually registers a provider.
//
// So compare them. The plugin's field set is read off the *configured* instance,
// which is what makes this catch option-driven columns too — `domainVerified`
// exists only because `domainVerification` is enabled in src/index.ts.

/**
 * The registered plugins are a union of eight unrelated literal types, so
 * `.find()` yields something on which neither `schema` nor `options` exists.
 * Both are part of Better Auth's plugin contract; this narrows to just the parts
 * these assertions read.
 */
type RegisteredPlugin = {
  id: string;
  schema?: Record<string, { fields: Record<string, unknown> }>;
  options?: unknown;
};

function findPlugin(pluginId: string): RegisteredPlugin {
  const plugins = auth.options.plugins as unknown as RegisteredPlugin[] | undefined;
  const plugin = plugins?.find((candidate) => candidate.id === pluginId);
  if (!plugin) throw new Error(`Plugin "${pluginId}" is not registered`);
  return plugin;
}

function pluginFields(pluginId: string, model: string): string[] {
  const fields = findPlugin(pluginId).schema?.[model]?.fields;
  if (!fields) throw new Error(`Plugin "${pluginId}" declares no "${model}" model`);

  // `id` is implicit for every Better Auth model.
  return ["id", ...Object.keys(fields)].sort();
}

describe("plugin tables match the hand-written Drizzle schema", () => {
  it("covers ssoProvider, including the domain-verification column", () => {
    expect(Object.keys(getTableColumns(ssoProvider)).sort()).toEqual(
      pluginFields("sso", "ssoProvider"),
    );
  });

  it.each([
    ["scimProvider", scimProvider],
    ["scimGroup", scimGroup],
    ["scimGroupMember", scimGroupMember],
    ["scimGroupRole", scimGroupRole],
    ["scimGroupRoleGrant", scimGroupRoleGrant],
  ] as const)("covers %s", (model, table) => {
    expect(Object.keys(getTableColumns(table)).sort()).toEqual(pluginFields("scim", model));
  });
});

describe("identity plugin configuration", () => {
  it("keeps sign-in gated on a verified domain", () => {
    // Without this, any organization admin could claim a domain they do not own
    // — `signIn.sso({ email })` resolves the provider purely by e-mail domain.
    const options = findPlugin("sso").options as {
      domainVerification?: { enabled?: boolean };
    };
    expect(options.domainVerification?.enabled).toBe(true);
  });

  it("stores SCIM tokens hashed and refuses personal connections", async () => {
    const options = findPlugin("scim").options as {
      storeSCIMToken?: string;
      beforeSCIMTokenGenerated?: (payload: {
        user: unknown;
        member: unknown | null;
        scimToken: string;
      }) => Promise<void>;
    };

    expect(options.storeSCIMToken).toBe("hashed");
    await expect(
      options.beforeSCIMTokenGenerated?.({ user: {}, member: null, scimToken: "token" }),
    ).rejects.toThrow("Organisation");
    await expect(
      options.beforeSCIMTokenGenerated?.({
        user: {},
        member: { role: "admin" },
        scimToken: "token",
      }),
    ).resolves.toBeUndefined();
  });
});
