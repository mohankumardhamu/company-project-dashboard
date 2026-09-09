CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"code" varchar(24) NOT NULL,
	"status" "account_status" DEFAULT 'ACTIVE' NOT NULL,
	"owner_director_id" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "account_id" varchar(30);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_director_id_users_id_fk" FOREIGN KEY ("owner_director_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_code_key" ON "accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_owner_idx" ON "accounts" USING btree ("owner_director_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_account_idx" ON "projects" USING btree ("account_id");