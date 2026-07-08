import { z } from "zod";

import { IdSchema } from "./shared";

/** Toggle input for per-user page state (favorites, subscriptions). */
export const PageRefInputSchema = z.object({ pageId: IdSchema });

export const ToggleResultSchema = z.object({
  pageId: IdSchema,
  active: z.boolean(),
});
