CREATE INDEX IF NOT EXISTS "course_item_course_id_idx" ON "course_item" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "course_code_idx" ON "course" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "free_course_user_id_idx" ON "free_course" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_course_term_idx" ON "schedule_course" USING btree ("term");