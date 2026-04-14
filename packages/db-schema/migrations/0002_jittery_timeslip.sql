CREATE TABLE IF NOT EXISTS "sim_agent" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sim_run_id" bigint NOT NULL,
	"operator_id" bigint,
	"agent_index" integer NOT NULL,
	"persona" text NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_agent_memory" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sim_run_id" bigint NOT NULL,
	"agent_id" bigint NOT NULL,
	"turn_index" integer NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"swarm_id" bigint NOT NULL,
	"fish_index" integer NOT NULL,
	"kind" text NOT NULL,
	"seed_applied" jsonb NOT NULL,
	"perturbation" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"report_finding_id" bigint,
	"llm_cost_usd" real,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_swarm" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"base_seed" jsonb NOT NULL,
	"perturbations" jsonb NOT NULL,
	"size" integer NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome_report_finding_id" bigint,
	"suggestion_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sim_turn" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sim_run_id" bigint NOT NULL,
	"turn_index" integer NOT NULL,
	"actor_kind" text NOT NULL,
	"agent_id" bigint,
	"action" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"observable_summary" text NOT NULL,
	"llm_cost_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_agent" ADD CONSTRAINT "sim_agent_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_agent" ADD CONSTRAINT "sim_agent_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_agent_memory" ADD CONSTRAINT "sim_agent_memory_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_agent_memory" ADD CONSTRAINT "sim_agent_memory_agent_id_sim_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."sim_agent"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_run" ADD CONSTRAINT "sim_run_swarm_id_sim_swarm_id_fk" FOREIGN KEY ("swarm_id") REFERENCES "public"."sim_swarm"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_run" ADD CONSTRAINT "sim_run_report_finding_id_research_finding_id_fk" FOREIGN KEY ("report_finding_id") REFERENCES "public"."research_finding"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_swarm" ADD CONSTRAINT "sim_swarm_outcome_report_finding_id_research_finding_id_fk" FOREIGN KEY ("outcome_report_finding_id") REFERENCES "public"."research_finding"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_turn" ADD CONSTRAINT "sim_turn_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sim_turn" ADD CONSTRAINT "sim_turn_agent_id_sim_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."sim_agent"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_agent_run" ON "sim_agent" ("sim_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sim_agent_run_index" ON "sim_agent" ("sim_run_id","agent_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_memory_run_agent" ON "sim_agent_memory" ("sim_run_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_memory_kind" ON "sim_agent_memory" ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_run_swarm" ON "sim_run" ("swarm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_run_status" ON "sim_run" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sim_run_swarm_fish" ON "sim_run" ("swarm_id","fish_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_swarm_status" ON "sim_swarm" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_swarm_started" ON "sim_swarm" ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_swarm_kind_status" ON "sim_swarm" ("kind","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_turn_run_turn" ON "sim_turn" ("sim_run_id","turn_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sim_turn_actor" ON "sim_turn" ("actor_kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sim_turn_run_turn_agent" ON "sim_turn" ("sim_run_id","turn_index","agent_id");