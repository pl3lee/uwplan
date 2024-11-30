ALTER TABLE "schedule_course" DROP CONSTRAINT "schedule_course_schedule_id_schedule_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_course" ADD CONSTRAINT "schedule_course_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
