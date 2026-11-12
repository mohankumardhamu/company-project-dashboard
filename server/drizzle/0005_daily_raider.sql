CREATE TYPE "public"."import_source" AS ENUM('RALLY', 'KEKA');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"source" "import_source" NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"period_start" date,
	"uploaded_by_id" varchar(30) NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"skipped_rows" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "keka_employees" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"employee_number" varchar(40) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"job_title" varchar(160),
	"department" varchar(160),
	"location" varchar(160),
	"reportees_count" integer DEFAULT 0 NOT NULL,
	"user_id" varchar(30),
	"batch_id" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rally_items" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"period_start" date NOT NULL,
	"work_product" varchar(400) NOT NULL,
	"release" varchar(160),
	"state" varchar(60) NOT NULL,
	"estimate" double precision DEFAULT 0 NOT NULL,
	"todo" double precision DEFAULT 0 NOT NULL,
	"time_spent" double precision DEFAULT 0 NOT NULL,
	"owner_raw" varchar(255) NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"batch_id" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "keka_employees" ADD CONSTRAINT "keka_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "keka_employees" ADD CONSTRAINT "keka_employees_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rally_items" ADD CONSTRAINT "rally_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rally_items" ADD CONSTRAINT "rally_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_source_created_idx" ON "import_batches" USING btree ("source","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keka_employees_employee_number_key" ON "keka_employees" USING btree ("employee_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keka_employees_user_idx" ON "keka_employees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rally_items_user_period_item_key" ON "rally_items" USING btree ("user_id","period_start","work_product");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rally_items_period_idx" ON "rally_items" USING btree ("period_start");