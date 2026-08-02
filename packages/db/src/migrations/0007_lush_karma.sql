CREATE TABLE "auth"."scim_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"scim_token" text NOT NULL,
	"organization_id" text,
	CONSTRAINT "scim_provider_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "scim_provider_scim_token_unique" UNIQUE("scim_token")
);
--> statement-breakpoint
CREATE TABLE "auth"."sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."scim_provider" ADD CONSTRAINT "scim_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scimProvider_organizationId_idx" ON "auth"."scim_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scimProvider_providerId_uidx" ON "auth"."scim_provider" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ssoProvider_userId_idx" ON "auth"."sso_provider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ssoProvider_organizationId_idx" ON "auth"."sso_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ssoProvider_domain_idx" ON "auth"."sso_provider" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "ssoProvider_providerId_uidx" ON "auth"."sso_provider" USING btree ("provider_id");