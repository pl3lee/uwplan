DO $$ BEGIN
 CREATE TYPE "public"."item_type" AS ENUM('requirement', 'instruction', 'separator');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_course" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(255) NOT NULL,
	"rating" integer,
	"difficulty" integer,
	"workload" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"type" "item_type" NOT NULL,
	"description" text,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_requirement_course" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"course_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "uw-course-planner_user_plan_course" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"take" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_item" ADD CONSTRAINT "uw-course-planner_item_plan_id_uw-course-planner_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."uw-course-planner_plan"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_plan" ADD CONSTRAINT "uw-course-planner_plan_user_id_uw-course-planner_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."uw-course-planner_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_requirement_course" ADD CONSTRAINT "uw-course-planner_requirement_course_item_id_uw-course-planner_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."uw-course-planner_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_requirement_course" ADD CONSTRAINT "uw-course-planner_requirement_course_course_id_uw-course-planner_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."uw-course-planner_course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_user_plan_course" ADD CONSTRAINT "uw-course-planner_user_plan_course_plan_id_uw-course-planner_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."uw-course-planner_plan"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "uw-course-planner_user_plan_course" ADD CONSTRAINT "uw-course-planner_user_plan_course_course_id_uw-course-planner_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."uw-course-planner_course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_plan_id_idx" ON "uw-course-planner_item" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_user_id_idx" ON "uw-course-planner_plan" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requirement_course_item_id_idx" ON "uw-course-planner_requirement_course" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requirement_course_course_id_idx" ON "uw-course-planner_requirement_course" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_plan_course_user_id_idx" ON "uw-course-planner_user_plan_course" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_plan_course_plan_id_idx" ON "uw-course-planner_user_plan_course" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_plan_course_course_id_idx" ON "uw-course-planner_user_plan_course" USING btree ("course_id");