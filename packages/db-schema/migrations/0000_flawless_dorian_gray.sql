CREATE TABLE IF NOT EXISTS "research_cycle" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trigger_type" "cycle_trigger" NOT NULL,
	"trigger_source" text,
	"user_id" bigint,
	"dag_plan" jsonb,
	"cortices_used" text[],
	"status" "cycle_status" NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"total_cost" real,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_finding" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"research_cycle_id" bigint NOT NULL,
	"cortex" "cortex" NOT NULL,
	"finding_type" "finding_type" NOT NULL,
	"status" "finding_status" DEFAULT 'active' NOT NULL,
	"urgency" "urgency",
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text,
	"confidence" real NOT NULL,
	"impact_score" real,
	"bus_context" jsonb,
	"reflexion_notes" jsonb,
	"iteration" integer DEFAULT 0 NOT NULL,
	"dedup_hash" text,
	"embedding" vector(1024),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_edge" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"finding_id" bigint NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" bigint NOT NULL,
	"relation" "relation" NOT NULL,
	"weight" real DEFAULT 1,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orbit_regime" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"altitude_band" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_class" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payload" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"technical_profile" jsonb,
	"photo_url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"ground_station" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_country" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"orbit_regime_id" bigint,
	"doctrine" jsonb,
	"bounds" jsonb,
	"centroid" jsonb,
	"geometry" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "satellite" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"launch_year" integer,
	"operator_country_id" bigint,
	"platform_class_id" bigint,
	"operator_id" bigint,
	"satellite_bus_id" bigint,
	"mass_kg" real,
	"is_experimental" boolean,
	"rating" real,
	"photo_url" text,
	"temperature" real,
	"lifetime" real,
	"power" real,
	"variant" text,
	"is_resilient" boolean,
	"classification_tier" text,
	"k_multiplier" real,
	"descriptions" jsonb,
	"g_short_description" text,
	"g_description" text,
	"g_operator_description" text,
	"g_operator_country_description" text,
	"g_orbit_regime_description" text,
	"g_launch_year_description" text,
	"profile_metadata" jsonb,
	"power_draw" real,
	"thermal_margin" real,
	"pointing_accuracy" real,
	"attitude_rate" real,
	"link_budget" real,
	"data_rate" real,
	"payload_duty" real,
	"eclipse_ratio" real,
	"solar_array_health" real,
	"battery_depth_of_discharge" real,
	"propellant_remaining" real,
	"radiation_dose" real,
	"debris_proximity" real,
	"mission_age" real,
	"telemetry_summary" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "satellite_bus" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform_class" text,
	"generation" text,
	"payloads" jsonb,
	"telemetry_summary" jsonb,
	"power_draw" real,
	"thermal_margin" real,
	"pointing_accuracy" real,
	"attitude_rate" real,
	"link_budget" real,
	"data_rate" real,
	"payload_duty" real,
	"eclipse_ratio" real,
	"solar_array_health" real,
	"battery_depth_of_discharge" real,
	"propellant_remaining" real,
	"radiation_dose" real,
	"debris_proximity" real,
	"mission_age" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "satellite_payload" (
	"satellite_id" bigint NOT NULL,
	"payload_id" bigint NOT NULL,
	"role" text,
	"mass_kg" real,
	"power_w" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "launch" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"name" text,
	"vehicle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sweep_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"suggestion_id" text NOT NULL,
	"operator_country_id" bigint,
	"operator_country_name" text NOT NULL,
	"category" "sweep_category" NOT NULL,
	"severity" "sweep_severity" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"suggested_action" text NOT NULL,
	"affected_satellites" integer DEFAULT 0 NOT NULL,
	"web_evidence" text,
	"accepted" boolean,
	"reviewer_note" text,
	"reviewed_at" timestamp with time zone,
	"resolution_status" "sweep_resolution_status",
	"resolution_payload" jsonb,
	"resolution_errors" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "article" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"content" text,
	"metadata" jsonb,
	"author_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exploration_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"query_type" text NOT NULL,
	"signal_source" text,
	"urls_crawled" integer DEFAULT 0 NOT NULL,
	"items_injected" integer DEFAULT 0 NOT NULL,
	"items_promoted" integer DEFAULT 0 NOT NULL,
	"quality_score" real,
	"exploration_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_edge" ADD CONSTRAINT "research_edge_finding_id_research_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."research_finding"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_finding" ADD CONSTRAINT "research_finding_research_cycle_id_research_cycle_id_fk" FOREIGN KEY ("research_cycle_id") REFERENCES "public"."research_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operator_country" ADD CONSTRAINT "operator_country_orbit_regime_id_orbit_regime_id_fk" FOREIGN KEY ("orbit_regime_id") REFERENCES "public"."orbit_regime"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite" ADD CONSTRAINT "satellite_operator_country_id_operator_country_id_fk" FOREIGN KEY ("operator_country_id") REFERENCES "public"."operator_country"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite" ADD CONSTRAINT "satellite_platform_class_id_platform_class_id_fk" FOREIGN KEY ("platform_class_id") REFERENCES "public"."platform_class"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite" ADD CONSTRAINT "satellite_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite" ADD CONSTRAINT "satellite_satellite_bus_id_satellite_bus_id_fk" FOREIGN KEY ("satellite_bus_id") REFERENCES "public"."satellite_bus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite_payload" ADD CONSTRAINT "satellite_payload_satellite_id_satellite_id_fk" FOREIGN KEY ("satellite_id") REFERENCES "public"."satellite"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "satellite_payload" ADD CONSTRAINT "satellite_payload_payload_id_payload_id_fk" FOREIGN KEY ("payload_id") REFERENCES "public"."payload"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sweep_audit" ADD CONSTRAINT "sweep_audit_operator_country_id_operator_country_id_fk" FOREIGN KEY ("operator_country_id") REFERENCES "public"."operator_country"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article" ADD CONSTRAINT "article_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_cycle_started" ON "research_cycle" ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_cycle_status" ON "research_cycle" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_edge_finding" ON "research_edge" ("finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_edge_entity" ON "research_edge" ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_edge_relation" ON "research_edge" ("relation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_finding_cycle" ON "research_finding" ("research_cycle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_finding_status_created" ON "research_finding" ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_finding_cortex_type" ON "research_finding" ("cortex","finding_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_research_finding_dedup" ON "research_finding" ("dedup_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_research_finding_expires" ON "research_finding" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sweep_audit_category" ON "sweep_audit" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sweep_audit_severity" ON "sweep_audit" ("severity","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sweep_audit_reviewed" ON "sweep_audit" ("reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sweep_audit_suggestion" ON "sweep_audit" ("suggestion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exploration_created" ON "exploration_log" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exploration_quality" ON "exploration_log" ("quality_score");
