import { z } from "zod";

import {
  GRANT_SUBJECT_MESSAGE,
  GrantRoleNameSchema,
  HexColorSchema,
  IdSchema,
  SlugSchema,
  WikiRoleSchema,
  grantNamesSubject,
} from "./shared";

export { WikiRoleSchema };

export const SpaceVisibilitySchema = z.enum(["public", "private", "restricted"]);

/** Full space representation returned by the API. */
export const SpaceSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  visibility: SpaceVisibilitySchema,
  createdBy: IdSchema.nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const CreateSpaceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Optional; derived from `name` and de-duplicated per org when omitted.
  slug: SlugSchema.optional(),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(64).nullish(),
  color: HexColorSchema.nullish(),
  visibility: SpaceVisibilitySchema.default("private"),
});

export const UpdateSpaceInputSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(64).nullish(),
  color: HexColorSchema.nullish(),
  visibility: SpaceVisibilitySchema.optional(),
});

export const ListSpacesInputSchema = z.object({
  // Space listing is org-scoped; defaults to the caller's active org.
  organizationId: IdSchema.optional(),
  includeArchived: z.boolean().default(false),
});

// --- Space members (per-space roles) ---------------------------------------

export type WikiRoleValue = z.infer<typeof WikiRoleSchema>;

export const PermissionSubjectSchema = z.enum(["user", "team", "role"]);

export const SpaceMemberSchema = z.object({
  id: IdSchema,
  spaceId: IdSchema,
  subject: PermissionSubjectSchema,
  role: WikiRoleSchema,
  // For subject="role" grants (org groups): the granted group's name.
  roleName: z.string().nullable(),
  user: z.object({ id: IdSchema, name: z.string(), email: z.string() }).nullable(),
  team: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: z.date(),
});
export type SpaceMember = z.infer<typeof SpaceMemberSchema>;

export const ListSpaceMembersInputSchema = z.object({ spaceId: IdSchema });

export const AddSpaceMemberInputSchema = z
  .object({
    spaceId: IdSchema,
    subject: PermissionSubjectSchema,
    userId: IdSchema.optional(),
    teamId: IdSchema.optional(),
    roleName: GrantRoleNameSchema.optional(),
    role: WikiRoleSchema.default("viewer"),
  })
  .refine(grantNamesSubject, { message: GRANT_SUBJECT_MESSAGE });

export const UpdateSpaceMemberInputSchema = z.object({ id: IdSchema, role: WikiRoleSchema });
export const RemoveSpaceMemberInputSchema = z.object({ id: IdSchema });
