-- Frozen legacy upgrade fixture from commit 145da3aa8b096c6d78842dc9104bba70e059c425.
-- Concatenates the original Drizzle migrations in journal order.
-- Test-only: independent of the Goose baseline; do not use for new schema changes.

-- Source: drizzle/0000_yielding_anthem.sql; SHA-256: 24fd57726da256cfe1f23ae239e4311d2651e21a10f41f00cd2434a3bdc6371c
DO $$ BEGIN
 CREATE TYPE "public"."course_item_type" AS ENUM('fixed', 'free');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."item_type" AS ENUM('requirement', 'instruction', 'separator');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"user_id" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" text,
	"session_state" varchar(255),
	CONSTRAINT "account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"type" "course_item_type" NOT NULL,
	"course_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(255) NOT NULL,
	"useful_rating" numeric(4, 3),
	"liked_rating" numeric(4, 3),
	"easy_rating" numeric(4, 3),
	"num_ratings" integer,
	CONSTRAINT "course_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "free_course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_item_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"filled_course_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_template" (
	"plan_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	CONSTRAINT "plan_template_plan_id_template_id_pk" PRIMARY KEY("plan_id","template_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_course" (
	"schedule_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"term" varchar(20) NOT NULL,
	CONSTRAINT "schedule_course_schedule_id_course_id_pk" PRIMARY KEY("schedule_id","course_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selected_course" (
	"plan_id" uuid NOT NULL,
	"course_item_id" uuid NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "selected_course_plan_id_course_item_id_pk" PRIMARY KEY("plan_id","course_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"session_token" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"type" "item_type" NOT NULL,
	"description" text,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"email_verified" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	"image" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_token" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_item" ADD CONSTRAINT "course_item_requirement_id_template_item_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."template_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "course_item" ADD CONSTRAINT "course_item_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_course_item_id_course_item_id_fk" FOREIGN KEY ("course_item_id") REFERENCES "public"."course_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_course" ADD CONSTRAINT "free_course_filled_course_id_course_id_fk" FOREIGN KEY ("filled_course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_template" ADD CONSTRAINT "plan_template_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_template" ADD CONSTRAINT "plan_template_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan" ADD CONSTRAINT "plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_course" ADD CONSTRAINT "schedule_course_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_course" ADD CONSTRAINT "schedule_course_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selected_course" ADD CONSTRAINT "selected_course_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selected_course" ADD CONSTRAINT "selected_course_course_item_id_course_item_id_fk" FOREIGN KEY ("course_item_id") REFERENCES "public"."course_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_item" ADD CONSTRAINT "template_item_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "course_item_requirement_id_idx" ON "course_item" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "free_course_item_user_idx" ON "free_course" USING btree ("course_item_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_user_id_idx" ON "plan" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" USING btree ("user_id");

-- Source: drizzle/0001_conscious_khan.sql; SHA-256: 67847589a6066eac8d552fc022f7c9b165b1ebcb7a4850e0b67e4944789df6f1
ALTER TABLE "schedule_course" DROP CONSTRAINT "schedule_course_schedule_id_schedule_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_course" ADD CONSTRAINT "schedule_course_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;


-- Source: drizzle/0002_colorful_dorian_gray.sql; SHA-256: cfb00cb588fcbd8bacb14a63c68a7df1944e97cda181aa00c1cd2db26d871eca
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


-- Source: drizzle/0003_real_champions.sql; SHA-256: 5c4cf0a6943376a2e39e2ec912b0f78d81d8ed434cd6caabafc264013bdf6962
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


-- Source: drizzle/0004_stiff_blue_blade.sql; SHA-256: 1d9d226d7169d84f7ae888b46730d654ca1d6ebdf3e5b0d8d6b3b1df083ac9da
CREATE INDEX IF NOT EXISTS "course_item_course_id_idx" ON "course_item" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "course_code_idx" ON "course" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "free_course_user_id_idx" ON "free_course" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_course_term_idx" ON "schedule_course" USING btree ("term");

-- Source: drizzle/0005_bright_dreadnoughts.sql; SHA-256: 073c7799a985e51f0f4c2dbe6050207d97cf391a211a3935ed5d36c97af4cbe3
ALTER TABLE "course" ADD COLUMN "description" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "prereqs" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "antireqs" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "coreqs" text DEFAULT '';

-- Source: drizzle/0006_majestic_clea.sql; SHA-256: 3bf5600ef8564abaa1e9e6bb27dcf48872db4d7b523b53e5120aa3450b4c8d9b
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

-- Source: drizzle/0007_redundant_mister_fear.sql; SHA-256: 9cd7e0a06280e632131f2daee3e385cb7f78c04d1f37fca718bbcf73d02c78b0
ALTER TYPE "role_type" ADD VALUE 'admin';

-- Source: drizzle/0008_purple_gressill.sql; SHA-256: be58c70720d98cedfe4bec9a6a2bd06e34b86a31935f3046a6acea677b5681e9
ALTER TABLE "template" ADD CONSTRAINT "template_name_unique" UNIQUE("name");

-- Source: drizzle/0009_material_gambit.sql; SHA-256: aa4307118fe0455baf5032df42cfbc1b2d2979a4e6875d2e2e689b6cf76f96f5
ALTER TABLE "template" ADD COLUMN "created_by" varchar(255);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template" ADD CONSTRAINT "template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

