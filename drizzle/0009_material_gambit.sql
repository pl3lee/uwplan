ALTER TABLE "template" ADD COLUMN "created_by" varchar(255);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template" ADD CONSTRAINT "template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
