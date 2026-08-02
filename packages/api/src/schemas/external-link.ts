import { z } from "zod";

import { MAX_EXTERNAL_URL_LENGTH, normalizeExternalUrl } from "../lib/external-url";
import { IdSchema } from "./shared";

/**
 * Every URL entering the API goes through the same normalizer the editor uses,
 * so the scheme allowlist is enforced server-side too — the RPC surface is also
 * a public OpenAPI endpoint, and a client-only check would guard nothing. The
 * transform means handlers receive the canonical form and never the raw input.
 */
export const ExternalUrlSchema = z
  .string()
  .min(1)
  .max(MAX_EXTERNAL_URL_LENGTH)
  .transform((value, ctx) => {
    const normalized = normalizeExternalUrl(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "must be a valid http(s) URL",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const ExternalLinkSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  url: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  createdBy: IdSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ExternalLink = z.infer<typeof ExternalLinkSchema>;

const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(500);

export const ListExternalLinksInputSchema = z.object({ pageId: IdSchema });

export const CreateExternalLinkInputSchema = z.object({
  pageId: IdSchema,
  url: ExternalUrlSchema,
  title: TitleSchema,
  description: DescriptionSchema.nullish(),
});

export const UpdateExternalLinkInputSchema = z.object({
  id: IdSchema,
  url: ExternalUrlSchema.optional(),
  title: TitleSchema.optional(),
  description: DescriptionSchema.nullish(),
});

/**
 * Moves one link one slot up or down. A relative step rather than an absolute
 * index: the client renders arrow buttons, and a stale index from a list edited
 * in another tab would silently reorder the wrong row.
 */
export const MoveExternalLinkInputSchema = z.object({
  id: IdSchema,
  direction: z.enum(["up", "down"]),
});
