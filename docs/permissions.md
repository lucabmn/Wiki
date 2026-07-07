# Permissions (RBAC)

How authorization works in this project, and how to use it in the backend and frontend.

The system is built on **Better Auth's organization plugin with Dynamic Access Control**. There is no second permission layer — Better Auth is the single source of truth. Roles and their permissions are enforced **server-side**; the frontend only mirrors them for UI gating.

---

## Concepts

| Term | Meaning |
|---|---|
| **Statement** | The full permission surface: a map of `resource -> actions`. Defined once, shared everywhere. |
| **Permission** | A `{ resource: [actions] }` pair, e.g. `{ page: ["delete"] }`. |
| **Access Control (`ac`)** | The engine built from the statement. Used to create roles. |
| **Role** | A named bundle of permissions. Two kinds: **static** (defined in code) and **dynamic** (created at runtime, stored in the DB). |
| **Group** | Product term for a **dynamic role**. "Create a group and give it permissions" == create a dynamic role. |
| **Member** | A user's membership in an organization. Carries one or more roles (comma-separated). |

A user's effective permissions come from **the roles on their member row in the organization being checked**. Everything is scoped to an organization.

---

## Where things live

| File | Contents |
|---|---|
| [`packages/auth/src/permissions.ts`](../packages/auth/src/permissions.ts) | The `statement`, the `ac` instance, static `roles`, and the `PermissionRequest` type. **Single source of truth.** Server-free — safe to import from the browser. |
| [`packages/auth/src/index.ts`](../packages/auth/src/index.ts) | Server org plugin wired with `ac`, `roles`, `dynamicAccessControl`. |
| [`apps/web/src/lib/auth-client.ts`](../apps/web/src/lib/auth-client.ts) | Client org plugin wired with the same `ac`/`roles`. |
| [`packages/api/src/index.ts`](../packages/api/src/index.ts) | Backend guards: `requireOrgPermission`, `assertOrgPermission`, `hasOrgPermission`. |
| [`apps/web/src/lib/use-permissions.ts`](../apps/web/src/lib/use-permissions.ts) | Frontend: `usePermission` hook, `checkStaticRolePermission`. |

> **Why `permissions.ts` must stay server-free:** it is imported by both the server package and the browser bundle (via `@nilovon-wiki/auth/permissions`). Never import db, env, or `./index` into it, or the database gets pulled into the client build.

---

## The statement

```ts
// packages/auth/src/permissions.ts
export const statement = {
  ...defaultStatements, // organization / member / invitation / team / ac
  space: ["create", "update", "delete"],
  page: ["create", "read", "update", "delete", "publish", "move"],
  comment: ["create", "update", "delete", "moderate"],
  attachment: ["create", "delete"],
} as const;
```

- `...defaultStatements` keeps Better Auth's built-in org-management permissions **plus the `ac` resource**, which controls who may manage dynamic roles (`admin` and `owner` have it).
- `as const` is required — it's what makes the whole system type-safe.

### Adding a new permission

1. Add the resource/actions to `statement`.
2. Grant it in the relevant static `roles` (`owner`/`admin`/`member`) if needed.
3. Done — `PermissionRequest` updates automatically, so backend guards and the frontend hook now accept it and reject typos.

No codegen, no DB change for the statement itself. (Adding it to a *dynamic* role is a runtime call — see [Groups](#groups-dynamic-roles).)

---

## Static roles

Defined in code, always available in every org:

- **owner** — everything.
- **admin** — content management + org admin, minus destructive org actions.
- **member** — read/create pages and comments, upload attachments.

They spread the matching Better Auth defaults (`ownerAc`/`adminAc`/`memberAc`) so owners/admins keep org-management and role-management (`ac`) rights.

---

## Backend usage

All guards live in [`packages/api/src/index.ts`](../packages/api/src/index.ts). They are fully typed against the statement.

### Gate a whole route (checks the active org)

```ts
import { requireOrgPermission } from "@nilovon-wiki/api";

export const deletePage = requireOrgPermission({ page: ["delete"] })
  .input(z.object({ pageId: z.string() }))
  .handler(async ({ input, context }) => {
    // reached only if the caller may delete pages in their active org
  });
```

### Gate on a resource's own org (preferred for anything cross-org)

`requireOrgPermission` checks the **active** organization. If a request targets a resource that lives in some *other* org, check against **that resource's** org id instead — otherwise rights in the active org would authorize actions elsewhere.

```ts
import { protectedProcedure, assertOrgPermission } from "@nilovon-wiki/api";

export const deletePage = protectedProcedure
  .input(z.object({ pageId: z.string() }))
  .handler(async ({ input, context }) => {
    const page = await getPage(input.pageId);
    await assertOrgPermission(context.headers, { page: ["delete"] }, page.organizationId);
    // ... delete
  });
```

### Helpers

```ts
// Boolean, never throws on "denied":
hasOrgPermission(headers, permissions, organizationId?) => Promise<boolean>

// Throws ORPCError("FORBIDDEN") when denied:
assertOrgPermission(headers, permissions, organizationId?) => Promise<void>
```

Both accept an optional `organizationId`; omit it to check the active org. `context.headers` is available on any `protectedProcedure` handler.

---

## Frontend usage

From [`apps/web/src/lib/use-permissions.ts`](../apps/web/src/lib/use-permissions.ts).

### `usePermission` — the default

Runs the check **server-side** (so it accounts for both static and dynamic roles) and caches the result in TanStack Query. Gating many elements off one permission fires a single request.

```tsx
import { usePermission } from "@/lib/use-permissions";

function DeleteButton() {
  const { allowed, isPending } = usePermission({ page: ["delete"] });
  if (isPending) return <Skeleton />;
  if (!allowed) return null;
  return <Button onClick={deletePage}>Delete</Button>;
}
```

- Checks the session's **active organization**. To check a different org, switch it first with `authClient.organization.setActive({ organizationId })`.
- After changing roles/members, refresh gated UI:
  ```ts
  import { PERMISSION_QUERY_KEY } from "@/lib/use-permissions";
  queryClient.invalidateQueries({ queryKey: PERMISSION_QUERY_KEY });
  ```

### `checkStaticRolePermission` — synchronous, static only

No network call, so it **ignores dynamic roles**. Use only when you already know the user's static role and want an instant answer.

```ts
const canDelete = checkStaticRolePermission({ page: ["delete"] }, "admin");
```

> UI gating is convenience only. The server always re-checks — never rely on the frontend for enforcement.

---

## Groups (dynamic roles)

"Groups" are **dynamic roles**: created at runtime, stored in the `organizationRole` table, permissioned from the same statement, and assigned to members. Only users whose role has the `ac` resource with `create` (i.e. `admin`/`owner`) may manage them.

### Create / update / delete / list

```ts
// Create a group with permissions
await authClient.organization.createRole({
  role: "editors",
  permission: { page: ["create", "update", "publish"], comment: ["moderate"] },
  organizationId, // optional; defaults to active org
});

await authClient.organization.updateRole({
  roleName: "editors",
  organizationId,
  data: { permission: { page: ["create", "update", "delete"] }, roleName: "senior-editors" },
});

await authClient.organization.deleteRole({ roleName: "editors", organizationId });

const { data: roles } = await authClient.organization.listRoles({ query: { organizationId } });
```

Server equivalents: `auth.api.createOrgRole`, `updateOrgRole`, `deleteOrgRole`, `listOrgRoles`, `getOrgRole` (each takes `{ body | query, headers }`).

### Assign a group to a user

A member's `role` field is comma-separated, so assigning multiple groups = multiple roles:

```ts
await authClient.organization.updateMemberRole({
  memberId,
  role: ["member", "editors"], // static + dynamic roles combined
  organizationId,
});
```

### Per-user override (optional)

There is no native per-user permission grant. To grant one user something extra, create a dynamic role for that grant and add it to their member's role list. Fine to defer.

---

## Onboarding flow (org creation)

When creating the first org in onboarding, **call `setActive` afterwards**:

```ts
const { data: org } = await authClient.organization.create({ name, slug });
await authClient.organization.setActive({ organizationId: org.id });
```

Without an active org, the first permission check resolves against nothing and fails.

---

## Gotchas

- **Everything is org-scoped.** A permission check always resolves against a specific org's member row. No active org ⇒ checks fail.
- **Client `hasPermission` always uses the active org.** It does not accept an `organizationId` — that's why `usePermission` has no org parameter. Switch orgs with `setActive`.
- **Cross-org safety is the backend's job.** Prefer `assertOrgPermission(headers, perms, resource.organizationId)` over the active-org `requireOrgPermission` whenever the target may live in another org.
- **`checkStaticRolePermission` ignores dynamic roles** (it's synchronous). Use `usePermission` when groups matter.
- **Teams ≠ groups.** Teams (`teams: { enabled: true }`) are org sub-units and carry **no** permissions. Permissions come from roles only.

---

## Verifying it works (round-trip)

After a DB migration (`pnpm --filter @nilovon-wiki/db db:push`), a quick end-to-end check:

1. Create an org → `setActive`.
2. `createRole({ role: "editors", permission: { page: ["delete"] } })`.
3. Assign it to a member via `updateMemberRole`.
4. `hasPermission({ permissions: { page: ["delete"] } })` returns `true`; `{ page: ["publish"] }` (not granted) returns `false`.

Type-checking alone won't catch the active-org and cross-org pitfalls above — exercise a real check.
