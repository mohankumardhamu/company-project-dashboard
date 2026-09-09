CREATE TYPE "public"."outcome_category" AS ENUM('REVENUE_ENABLED', 'COST_SAVED', 'RISK_REDUCED', 'CAPABILITY_BUILT', 'CUSTOMER_VISIBLE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outcome_tasks" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"outcome_id" varchar(30) NOT NULL,
	"task_id" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outcomes" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"landed_on" date NOT NULL,
	"narrative" text NOT NULL,
	"category" "outcome_category" NOT NULL,
	"team_id" varchar(30) NOT NULL,
	"pm_id" varchar(30) NOT NULL,
	"verified_by_id" varchar(30),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcome_tasks" ADD CONSTRAINT "outcome_tasks_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcome_tasks" ADD CONSTRAINT "outcome_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_pm_id_users_id_fk" FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_tasks_outcome_task_key" ON "outcome_tasks" USING btree ("outcome_id","task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_tasks_task_idx" ON "outcome_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcomes_team_idx" ON "outcomes" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcomes_landed_on_idx" ON "outcomes" USING btree ("landed_on");