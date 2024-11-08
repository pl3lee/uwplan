CREATE TABLE IF NOT EXISTS "uw-course-planner_user_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"template_id" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_user_template" ADD CONSTRAINT "uw-course-planner_user_template_user_id_uw-course-planner_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."uw-course-planner_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_user_template" ADD CONSTRAINT "uw-course-planner_user_template_template_id_uw-course-planner_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."uw-course-planner_template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_template_user_id_idx" ON "uw-course-planner_user_template" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_template_template_id_idx" ON "uw-course-planner_user_template" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_template_user_template_idx" ON "uw-course-planner_user_template" USING btree ("user_id","template_id");