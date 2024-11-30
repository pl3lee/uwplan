DO $$ BEGIN
 CREATE TYPE "public"."season" AS ENUM('Fall', 'Winter', 'Spring');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_term_range" (
	"user_id" varchar(255) PRIMARY KEY NOT NULL,
	"start_term" "season" NOT NULL,
	"start_year" integer NOT NULL,
	"end_term" "season" NOT NULL,
	"end_year" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_term_range" ADD CONSTRAINT "user_term_range_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
