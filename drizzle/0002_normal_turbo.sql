CREATE TABLE IF NOT EXISTS "uw-course-planner_template_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"type" "item_type" NOT NULL,
	"description" text,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_template_requirement_course" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"course_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uw-course-planner_plan" ADD COLUMN "template_id" integer NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_template_item" ADD CONSTRAINT "uw-course-planner_template_item_template_id_uw-course-planner_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."uw-course-planner_template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_template_requirement_course" ADD CONSTRAINT "uw-course-planner_template_requirement_course_item_id_uw-course-planner_template_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."uw-course-planner_template_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_template_requirement_course" ADD CONSTRAINT "uw-course-planner_template_requirement_course_course_id_uw-course-planner_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."uw-course-planner_course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_item_template_id_idx" ON "uw-course-planner_template_item" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_requirement_course_item_id_idx" ON "uw-course-planner_template_requirement_course" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_requirement_course_course_id_idx" ON "uw-course-planner_template_requirement_course" USING btree ("course_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_plan" ADD CONSTRAINT "uw-course-planner_plan_template_id_uw-course-planner_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."uw-course-planner_template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_template_id_idx" ON "uw-course-planner_plan" USING btree ("template_id");