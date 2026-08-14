import { boolean, index, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../_helpers";
import { organization, user } from "../auth";
import { learnSchema } from "./_schema";
import { course, courseCollection } from "./courses";
import { entitlementSource, priceInterval, productKind, purchaseStatus } from "./enums";

/**
 * Paid access, modelled around *entitlement* rather than around a payment
 * processor.
 *
 * Access control only ever asks one question — "does this user hold a live
 * entitlement for this product?" — and that question has an answer whether the
 * money arrived through Stripe, an invoice, or an admin handing out seats. The
 * processor therefore appears only as `provider` + `external_id` columns on
 * `purchase`, and an adapter fills them in. Nothing below imports a payment SDK.
 */

/** A sellable thing: one course, or one collection. */
export const product = learnSchema.table(
  "product",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: productKind("kind").notNull(),
    courseId: text("course_id").references(() => course.id, { onDelete: "cascade" }),
    collectionId: text("collection_id").references(() => courseCollection.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    /** Inactive products keep existing entitlements alive but cannot be bought. */
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // A course or collection is sold as at most one product; two products for
    // the same course would make "is this paid for?" ambiguous.
    uniqueIndex("product_course_uq").on(t.courseId),
    uniqueIndex("product_collection_uq").on(t.collectionId),
    index("product_org_idx").on(t.organizationId),
  ],
);

/** A price point. Several may be active at once (currencies, intervals). */
export const productPrice = learnSchema.table(
  "product_price",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    /** ISO 4217, uppercase. */
    currency: text("currency").notNull().default("EUR"),
    /** Minor units (cents) — never a float. */
    amountCents: integer("amount_cents").notNull(),
    interval: priceInterval("interval").notNull().default("one_time"),
    /** The processor's own id for this price, when one exists. */
    externalPriceId: text("external_price_id"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("product_price_product_idx").on(t.productId)],
);

/** One payment attempt. Written by the checkout flow, updated by the webhook. */
export const purchase = learnSchema.table(
  "purchase",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    priceId: text("price_id").references(() => productPrice.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: purchaseStatus("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    /** Which adapter produced this row, e.g. "stripe" or "manual". */
    provider: text("provider").notNull().default("manual"),
    /**
     * The processor's id for the payment. Unique per provider so a webhook
     * delivered twice cannot create a second purchase or a second entitlement.
     */
    externalId: text("external_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("purchase_provider_external_uq").on(t.provider, t.externalId),
    index("purchase_user_idx").on(t.userId),
    index("purchase_product_idx").on(t.productId),
  ],
);

/**
 * The right to access a product. The single thing access control reads — see
 * `hasEntitlement` in the API's course-access module.
 */
export const entitlement = learnSchema.table(
  "entitlement",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: entitlementSource("source").notNull().default("purchase"),
    purchaseId: text("purchase_id").references(() => purchase.id, { onDelete: "set null" }),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    /** `null` = perpetual. Subscriptions set and extend this. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("entitlement_user_product_uq").on(t.userId, t.productId),
    index("entitlement_product_idx").on(t.productId),
  ],
);
