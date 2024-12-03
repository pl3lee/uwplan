ALTER TABLE "course_item" DROP CONSTRAINT "course_item_requirement_id_template_item_id_fk";
--> statement-breakpoint
ALTER TABLE "course_item" DROP CONSTRAINT "course_item_course_id_course_id_fk";
--> statement-breakpoint
ALTER TABLE "free_course" DROP CONSTRAINT "free_course_course_item_id_course_item_id_fk";
--> statement-breakpoint
ALTER TABLE "free_course" DROP CONSTRAINT "free_course_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "free_course" DROP CONSTRAINT "free_course_filled_course_id_course_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_template" DROP CONSTRAINT "plan_template_plan_id_plan_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_template" DROP CONSTRAINT "plan_template_template_id_template_id_fk";
--> statement-breakpoint
ALTER TABLE "plan" DROP CONSTRAINT "plan_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule" DROP CONSTRAINT "schedule_plan_id_plan_id_fk";
--> statement-breakpoint
ALTER TABLE "selected_course" DROP CONSTRAINT "selected_course_plan_id_plan_id_fk";
--> statement-breakpoint
ALTER TABLE "selected_course" DROP CONSTRAINT "selected_course_course_item_id_course_item_id_fk";
--> statement-breakpoint
ALTER TABLE "template_item" DROP CONSTRAINT "template_item_template_id_template_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_item" ADD CONSTRAINT "course_item_requirement_id_template_item_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."template_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_item" ADD CONSTRAINT "course_item_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_course_item_id_course_item_id_fk" FOREIGN KEY ("course_item_id") REFERENCES "public"."course_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_filled_course_id_course_id_fk" FOREIGN KEY ("filled_course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_template" ADD CONSTRAINT "plan_template_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_template" ADD CONSTRAINT "plan_template_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan" ADD CONSTRAINT "plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selected_course" ADD CONSTRAINT "selected_course_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selected_course" ADD CONSTRAINT "selected_course_course_item_id_course_item_id_fk" FOREIGN KEY ("course_item_id") REFERENCES "public"."course_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_item" ADD CONSTRAINT "template_item_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
