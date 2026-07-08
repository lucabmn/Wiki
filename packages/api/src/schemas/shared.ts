import { z } from "zod";

/** A cuid2 identifier as issued by the db `id()` helper. */
export const IdSchema = z.string().min(1).max(32);

/** ISO timestamp fields present on most rows via the `timestamps` helper. */
export const TimestampsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Cursor pagination input. Keyset over `createdAt`+`id` so it stays stable as
 * rows are inserted. `cursor` is an opaque token returned by the previous page.
 */
export const PaginationInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

/** Wraps a page of results with the cursor for the next page (null = last). */
export function PageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
