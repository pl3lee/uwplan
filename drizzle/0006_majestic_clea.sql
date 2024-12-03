DO $$ BEGIN
 CREATE TYPE "public"."role_type" AS ENUM('user', 'moderator');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "course" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course" ALTER COLUMN "prereqs" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course" ALTER COLUMN "antireqs" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "course" ALTER COLUMN "coreqs" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "role_type" DEFAULT 'user' NOT NULL;