import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { entitlement, product, productPrice, purchase } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { requireCourseCapabilityById } from "../lib/learn-authz";
import { loadCourse } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { IdSchema } from "../schemas/shared";

/**
 * Paid course access.
 *
 * The model is deliberately built around **entitlement** rather than around a
 * payment processor: access control only ever asks "does this user hold a live
 * entitlement for this product", and that question has an answer whether the
 * money arrived through a card, an invoice, or an admin handing out seats.
 *
 * What is here works end to end without any processor: an administrator can
 * define products and prices, and grant or revoke entitlements. What is NOT
 * here is a checkout adapter — a `purchase` row carries `provider` and
 * `externalId` columns precisely so one can be added without touching the
 * access rules, but no such adapter ships in this repository yet, and the
 * `paid` enrolment policy therefore depends on entitlements being granted by
 * some out-of-band process.
 */

const TAGS = ["Commerce"];

const ProductSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  kind: z.enum(["course", "collection"]),
  courseId: IdSchema.nullable(),
  collectionId: IdSchema.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  prices: z.array(
    z.object({
      id: IdSchema,
      currency: z.string(),
      amountCents: z.number().int(),
      interval: z.enum(["one_time", "month", "year"]),
      active: z.boolean(),
    }),
  ),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const EntitlementSchema = z.object({
  id: IdSchema,
  productId: IdSchema,
  userId: IdSchema,
  source: z.enum(["purchase", "grant"]),
  startsAt: z.date(),
  endsAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const commerceRouter = {
  listProducts: protectedProcedure
    .route({
      method: "GET",
      path: "/products",
      tags: TAGS,
      summary: "List the organization's sellable products",
    })
    .input(z.object({ activeOnly: z.boolean().default(false) }))
    .output(z.array(ProductSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const rows = await context.db.query.product.findMany({
        where: and(
          eq(product.organizationId, organizationId),
          input.activeOnly ? eq(product.active, true) : undefined,
        ),
        with: { prices: true },
        orderBy: [desc(product.createdAt)],
      });
      return rows.map((row) => ({
        ...row,
        prices: row.prices.map((price) => ({
          id: price.id,
          currency: price.currency,
          amountCents: price.amountCents,
          interval: price.interval,
          active: price.active,
        })),
      }));
    }),

  createProduct: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "POST",
      path: "/products",
      tags: TAGS,
      summary: "Make a course sellable",
    })
    .input(
      z.object({
        courseId: IdSchema,
        name: z.string().min(1).max(160),
        description: z.string().max(2000).nullish(),
        amountCents: z.number().int().min(0).max(100_000_000),
        currency: z.string().length(3).default("EUR"),
        interval: z.enum(["one_time", "month", "year"]).default("one_time"),
      }),
    )
    .output(ProductSchema)
    .handler(async ({ input, context }) => {
      const course = await loadCourse(context.db, input.courseId);
      await requireCourseCapabilityById(context.db, context, context.headers, course.id, "manage");

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const row = firstRow(
              await tx
                .insert(product)
                .values({
                  organizationId: course.organizationId,
                  kind: "course",
                  courseId: course.id,
                  name: input.name,
                  description: input.description ?? null,
                })
                .returning(),
            );
            const price = firstRow(
              await tx
                .insert(productPrice)
                .values({
                  productId: row.id,
                  currency: input.currency.toUpperCase(),
                  amountCents: input.amountCents,
                  interval: input.interval,
                })
                .returning(),
            );
            return {
              ...row,
              prices: [
                {
                  id: price.id,
                  currency: price.currency,
                  amountCents: price.amountCents,
                  interval: price.interval,
                  active: price.active,
                },
              ],
            };
          }),
        // One product per course: two would make "is this paid for?" ambiguous.
        "This course is already sold as a product",
      );
    }),

  updateProduct: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "PATCH",
      path: "/products/{id}",
      tags: TAGS,
      summary: "Rename a product or take it off sale",
    })
    .input(
      z.object({
        id: IdSchema,
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .output(z.object({ id: IdSchema, active: z.boolean() }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await loadProduct(context, input.id, organizationId);
      const updated = firstRow(
        await context.db
          .update(product)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description ?? null } : {}),
            // Deactivating stops new sales; it deliberately does not touch the
            // entitlements already granted, or a price change would revoke the
            // access people paid for.
            ...(input.active !== undefined ? { active: input.active } : {}),
          })
          .where(eq(product.id, row.id))
          .returning(),
      );
      return { id: updated.id, active: updated.active };
    }),

  addPrice: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "POST",
      path: "/products/{id}/prices",
      tags: TAGS,
      summary: "Add a price point to a product",
    })
    .input(
      z.object({
        id: IdSchema,
        amountCents: z.number().int().min(0).max(100_000_000),
        currency: z.string().length(3).default("EUR"),
        interval: z.enum(["one_time", "month", "year"]).default("one_time"),
        /** Take every existing price out of circulation. */
        replaceExisting: z.boolean().default(false),
      }),
    )
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await loadProduct(context, input.id, organizationId);
      return context.db.transaction(async (tx) => {
        if (input.replaceExisting) {
          // Prices are deactivated, never deleted: a purchase points at the
          // price it was made under, and that record has to survive a change.
          await tx
            .update(productPrice)
            .set({ active: false })
            .where(eq(productPrice.productId, row.id));
        }
        const price = firstRow(
          await tx
            .insert(productPrice)
            .values({
              productId: row.id,
              currency: input.currency.toUpperCase(),
              amountCents: input.amountCents,
              interval: input.interval,
            })
            .returning(),
        );
        return { id: price.id };
      });
    }),

  listEntitlements: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "GET",
      path: "/products/{id}/entitlements",
      tags: TAGS,
      summary: "Who holds access to a product",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(EntitlementSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await loadProduct(context, input.id, organizationId);
      return context.db.query.entitlement.findMany({
        where: eq(entitlement.productId, row.id),
        orderBy: [desc(entitlement.createdAt)],
      });
    }),

  grantEntitlement: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "POST",
      path: "/products/{id}/entitlements",
      tags: TAGS,
      summary: "Give someone access to a paid product without a payment",
    })
    .input(
      z.object({
        id: IdSchema,
        userId: IdSchema,
        /** Perpetual when omitted. */
        endsAt: z.coerce.date().nullish(),
      }),
    )
    .output(EntitlementSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await loadProduct(context, input.id, organizationId);
      return firstRow(
        await context.db
          .insert(entitlement)
          .values({
            organizationId,
            productId: row.id,
            userId: input.userId,
            source: "grant",
            grantedBy: context.session.user.id,
            endsAt: input.endsAt ?? null,
          })
          // Re-granting to somebody who already has access revives a revoked
          // row rather than failing — the administrator's intent is the same.
          .onConflictDoUpdate({
            target: [entitlement.userId, entitlement.productId],
            set: { revokedAt: null, endsAt: input.endsAt ?? null, source: "grant" },
          })
          .returning(),
      );
    }),

  revokeEntitlement: requireOrgPermission({ course: ["manage"] })
    .route({
      method: "DELETE",
      path: "/entitlements/{id}",
      tags: TAGS,
      summary: "Withdraw access to a paid product",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await context.db.query.entitlement.findFirst({
        where: and(eq(entitlement.id, input.id), eq(entitlement.organizationId, organizationId)),
      });
      if (!row) throw new ORPCError("NOT_FOUND");
      // Revoked, not deleted: what someone was allowed to reach, and until
      // when, is exactly the question a billing dispute asks.
      await context.db
        .update(entitlement)
        .set({ revokedAt: new Date() })
        .where(eq(entitlement.id, row.id));
      return { id: row.id };
    }),

  myEntitlements: protectedProcedure
    .route({
      method: "GET",
      path: "/entitlements/mine",
      tags: TAGS,
      summary: "The paid products the caller currently has access to",
    })
    .input(z.object({}))
    .output(z.array(EntitlementSchema))
    .handler(async ({ context }) => {
      const now = new Date();
      return context.db.query.entitlement.findMany({
        where: and(
          eq(entitlement.userId, context.session.user.id),
          isNull(entitlement.revokedAt),
          or(isNull(entitlement.endsAt), gt(entitlement.endsAt, now)),
        ),
        orderBy: [desc(entitlement.createdAt)],
      });
    }),

  myPurchases: protectedProcedure
    .route({
      method: "GET",
      path: "/purchases/mine",
      tags: TAGS,
      summary: "The caller's payment history",
    })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          id: IdSchema,
          productId: IdSchema,
          status: z.enum(["pending", "paid", "refunded", "failed"]),
          amountCents: z.number().int(),
          currency: z.string(),
          provider: z.string(),
          paidAt: z.date().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .handler(async ({ context }) =>
      context.db.query.purchase.findMany({
        where: eq(purchase.userId, context.session.user.id),
        orderBy: [desc(purchase.createdAt)],
      }),
    ),
};

/** A product in the caller's own organization, or NOT_FOUND. */
async function loadProduct(
  context: { db: import("@nilovon-wiki/db").Database },
  id: string,
  organizationId: string,
) {
  const row = await context.db.query.product.findFirst({
    where: and(eq(product.id, id), eq(product.organizationId, organizationId)),
  });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Product not found" });
  return row;
}
