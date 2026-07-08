CREATE INDEX "attachment_uploaded_by_idx" ON "wiki"."attachment" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "comment_author_idx" ON "wiki"."comment" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "page_created_by_idx" ON "wiki"."page" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "page_last_edited_by_idx" ON "wiki"."page" USING btree ("last_edited_by");--> statement-breakpoint
CREATE INDEX "page_subscription_page_idx" ON "wiki"."page_subscription" USING btree ("page_id");