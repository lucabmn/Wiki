import { z } from "zod";

import { IdSchema } from "./shared";

export const PageStatusSchema = z.enum(["draft", "published", "archived"]);

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");

/** Rich-text document (ProseMirror/TipTap JSON). Opaque to the API layer. */
const DocumentSchema = z.unknown();

/** Full page representation returned by the API (search vector excluded). */
export const PageSchema = z.object({
  id: IdSchema,
  spaceId: IdSchema,
  parentId: IdSchema.nullable(),
  title: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  coverImage: z.string().nullable(),
  content: DocumentSchema.nullable(),
  textContent: z.string(),
  status: PageStatusSchema,
  // Per-page access override; null = inherit the space's access.
  visibility: z.enum(["public", "private", "restricted"]).nullable(),
  isTemplate: z.boolean(),
  position: z.string(),
  createdBy: IdSchema.nullable(),
  lastEditedBy: IdSchema.nullable(),
  publishedAt: z.date().nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Page = z.infer<typeof PageSchema>;

export const ListPagesInputSchema = z.object({
  spaceId: IdSchema,
  // Filter to direct children of a page; omit for the whole space.
  parentId: IdSchema.nullish(),
  status: PageStatusSchema.optional(),
  includeArchived: z.boolean().default(false),
});

export const CreatePageInputSchema = z.object({
  spaceId: IdSchema,
  parentId: IdSchema.nullish(),
  title: z.string().min(1).max(300).default("Untitled"),
  slug: SlugSchema.optional(),
  icon: z.string().max(64).nullish(),
  coverImage: z.string().max(2048).nullish(),
  content: DocumentSchema.optional(),
  textContent: z.string().default(""),
  isTemplate: z.boolean().default(false),
});

// Note: no `content`/`textContent` here. The page body is a collaborative
// working copy (see `apps/collab`) whose published projection advances ONLY via
// `pages.publish`. Letting a plain PATCH write `content` would leak an
// unpublished body into the reader-facing columns, so update carries metadata
// only.
export const UpdatePageInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(300).optional(),
  slug: SlugSchema.optional(),
  icon: z.string().max(64).nullish(),
  coverImage: z.string().max(2048).nullish(),
  isTemplate: z.boolean().optional(),
});

/**
 * Publishing promotes the caller's current working copy (the live collab doc,
 * read client-side via `editor.getJSON()`/`getText()`) into the page's
 * published projection and snapshots a revision. Content/title are optional so
 * an API-only re-publish falls back to the page's existing published state.
 */
export const PublishPageInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(300).optional(),
  content: DocumentSchema.optional(),
  textContent: z.string().optional(),
  summary: z.string().max(500).optional(),
});

export const MovePageInputSchema = z
  .object({
    id: IdSchema,
    // New parent (null = space root). Omit to keep the current parent.
    parentId: IdSchema.nullish(),
    // Reorder relative to a sibling; provide at most one.
    beforeId: IdSchema.optional(),
    afterId: IdSchema.optional(),
  })
  .refine((v) => !(v.beforeId && v.afterId), {
    message: "provide beforeId or afterId, not both",
  });

/** Immutable version snapshot. */
export const PageRevisionSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  version: z.number().int(),
  title: z.string(),
  content: DocumentSchema.nullable(),
  textContent: z.string(),
  summary: z.string().nullable(),
  editedBy: IdSchema.nullable(),
  createdAt: z.date(),
});

/** Per-user autosave draft. */
export const PageDraftSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  userId: IdSchema,
  title: z.string().nullable(),
  content: DocumentSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SaveDraftInputSchema = z.object({
  pageId: IdSchema,
  title: z.string().max(300).nullish(),
  content: DocumentSchema.optional(),
});

// --- Page access (per-page ACL) --------------------------------------------

export const WikiRoleSchema = z.enum(["viewer", "commenter", "editor", "admin"]);

export const PageMemberSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  subject: z.enum(["user", "team", "role"]),
  role: WikiRoleSchema,
  // For subject="role" grants (org groups): the granted group's name.
  roleName: z.string().nullable(),
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }).nullable(),
  team: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: z.date(),
});

export const PageAccessSchema = z.object({
  pageId: IdSchema,
  visibility: z.enum(["public", "private", "restricted"]).nullable(),
  members: z.array(PageMemberSchema),
});

export const MyPageRoleSchema = z.object({
  role: WikiRoleSchema.nullable(),
  canWrite: z.boolean(),
  canManage: z.boolean(),
});

export const SetPageVisibilityInputSchema = z.object({
  pageId: IdSchema,
  visibility: z.enum(["public", "private", "restricted"]).nullable(),
});

export const AddPageMemberInputSchema = z
  .object({
    pageId: IdSchema,
    subject: z.enum(["user", "team", "role"]),
    userId: IdSchema.optional(),
    teamId: IdSchema.optional(),
    roleName: z.string().min(1).optional(),
    role: WikiRoleSchema.default("viewer"),
  })
  .refine(
    (v) => (v.subject === "user" ? !!v.userId : v.subject === "team" ? !!v.teamId : !!v.roleName),
    { message: "Provide userId (user), teamId (team), or roleName (group)" },
  );

export const UpdatePageMemberInputSchema = z.object({ id: IdSchema, role: WikiRoleSchema });
export const RemovePageMemberInputSchema = z.object({ id: IdSchema });
