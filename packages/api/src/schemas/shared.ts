import { z } from "zod";

/** A cuid2 identifier as issued by the db `id()` helper. */
export const IdSchema = z.string().min(1).max(32);
