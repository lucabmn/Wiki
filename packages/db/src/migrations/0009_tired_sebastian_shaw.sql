CREATE TABLE "auth"."scim_group" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"scim_group_id" text NOT NULL,
	"external_id" text,
	"external_id_key" text,
	"display_name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "scim_group_scim_group_id_unique" UNIQUE("scim_group_id"),
	CONSTRAINT "scim_group_external_id_key_unique" UNIQUE("external_id_key")
);
--> statement-breakpoint
CREATE TABLE "auth"."scim_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"membership_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "scim_group_member_membership_key_unique" UNIQUE("membership_key")
);
--> statement-breakpoint
CREATE TABLE "auth"."scim_group_role" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"role" text NOT NULL,
	"role_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "scim_group_role_role_key_unique" UNIQUE("role_key")
);
--> statement-breakpoint
CREATE TABLE "auth"."scim_group_role_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"role_grant_key" text NOT NULL,
	"is_role_projected" boolean NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "scim_group_role_grant_role_grant_key_unique" UNIQUE("role_grant_key")
);
--> statement-breakpoint
ALTER TABLE "auth"."scim_provider" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "wiki"."attachment" ADD COLUMN "is_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki"."attachment" ADD COLUMN "publish_on_next_publish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "wiki"."attachment" AS a
SET "is_draft" = true, "publish_on_next_publish" = true
FROM "wiki"."page" AS p
WHERE a."page_id" = p."id" AND p."published_at" IS NULL;--> statement-breakpoint
ALTER TABLE "auth"."scim_group" ADD CONSTRAINT "scim_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_member" ADD CONSTRAINT "scim_group_member_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "auth"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_member" ADD CONSTRAINT "scim_group_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_member" ADD CONSTRAINT "scim_group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_role" ADD CONSTRAINT "scim_group_role_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "auth"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_role_grant" ADD CONSTRAINT "scim_group_role_grant_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "auth"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_role_grant" ADD CONSTRAINT "scim_group_role_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."scim_group_role_grant" ADD CONSTRAINT "scim_group_role_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scimGroup_providerId_idx" ON "auth"."scim_group" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "scimGroup_organizationId_idx" ON "auth"."scim_group" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_groupId_idx" ON "auth"."scim_group_member" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_providerId_idx" ON "auth"."scim_group_member" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_organizationId_idx" ON "auth"."scim_group_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_userId_idx" ON "auth"."scim_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scimGroupRole_groupId_idx" ON "auth"."scim_group_role" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "scimGroupRoleGrant_groupId_idx" ON "auth"."scim_group_role_grant" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "scimGroupRoleGrant_providerId_idx" ON "auth"."scim_group_role_grant" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "scimGroupRoleGrant_organizationId_idx" ON "auth"."scim_group_role_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scimGroupRoleGrant_userId_idx" ON "auth"."scim_group_role_grant" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "auth"."scim_provider" ADD CONSTRAINT "scim_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scimProvider_userId_idx" ON "auth"."scim_provider" USING btree ("user_id");