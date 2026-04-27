CREATE TABLE "temporal_evaluation_metric" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"evaluation_run_id" bigint NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" real NOT NULL,
	"segment" text NOT NULL,
	"baseline_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_evaluation_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"train_window" text NOT NULL,
	"validation_window" text NOT NULL,
	"test_window" text NOT NULL,
	"config_hash" text NOT NULL,
	"baselines_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "temporal_event" (
	"id" text PRIMARY KEY NOT NULL,
	"projection_run_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"event_source" text NOT NULL,
	"entity_id" text,
	"sim_run_id" bigint,
	"fish_index" integer,
	"turn_index" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"agent_id" text,
	"action_kind" text,
	"confidence_before" real,
	"confidence_after" real,
	"review_outcome" text,
	"terminal_status" text,
	"embedding_id" text,
	"seeded_by_pattern_id" text,
	"source_domain" text NOT NULL,
	"canonical_signature" text NOT NULL,
	"source_table" text NOT NULL,
	"source_pk" text NOT NULL,
	"payload_hash" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_learning_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_version" text NOT NULL,
	"source_domain" text NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"params_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"metrics_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_edge" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_id" bigint NOT NULL,
	"from_signature" text NOT NULL,
	"to_signature" text NOT NULL,
	"weight" real NOT NULL,
	"support_count" integer NOT NULL,
	"avg_delta_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_example" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_id" bigint NOT NULL,
	"event_id" text NOT NULL,
	"role" text NOT NULL,
	"entity_id" text,
	"sim_run_id" bigint,
	"fish_index" integer,
	"turn_index" integer,
	"embedding_id" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_hypothesis" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_hash" text NOT NULL,
	"pattern_version" text NOT NULL,
	"status" text NOT NULL,
	"source_domain" text NOT NULL,
	"terminal_status" text NOT NULL,
	"pattern_window_ms" integer NOT NULL,
	"pattern_score" real NOT NULL,
	"support_count" integer NOT NULL,
	"negative_support_count" integer DEFAULT 0 NOT NULL,
	"baseline_rate" real,
	"lift" real,
	"score_components_json" jsonb DEFAULT '{"temporal_weight":0,"support_factor":0,"lift_factor":0,"negative_penalty":0,"stability_factor":1}'::jsonb NOT NULL,
	"created_from_learning_run_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_query_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"consumer" text NOT NULL,
	"pattern_id" bigint,
	"query_hash" text NOT NULL,
	"used_for_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_review" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_id" bigint NOT NULL,
	"reviewer_id" bigint,
	"review_outcome" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_seeded_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_id" bigint NOT NULL,
	"sim_run_id" bigint NOT NULL,
	"seed_reason" text NOT NULL,
	"source_domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_pattern_step" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pattern_id" bigint NOT NULL,
	"step_index" integer NOT NULL,
	"event_signature" text NOT NULL,
	"event_type" text NOT NULL,
	"event_source" text NOT NULL,
	"avg_delta_ms" integer NOT NULL,
	"support_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_projection_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"projection_version" text NOT NULL,
	"source_scope" text NOT NULL,
	"from_ts" timestamp with time zone NOT NULL,
	"to_ts" timestamp with time zone NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"status" text NOT NULL,
	"metrics_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "temporal_evaluation_metric" ADD CONSTRAINT "temporal_evaluation_metric_evaluation_run_id_temporal_evaluation_run_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."temporal_evaluation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_event" ADD CONSTRAINT "temporal_event_projection_run_id_temporal_projection_run_id_fk" FOREIGN KEY ("projection_run_id") REFERENCES "public"."temporal_projection_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_event" ADD CONSTRAINT "temporal_event_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_edge" ADD CONSTRAINT "temporal_pattern_edge_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_example" ADD CONSTRAINT "temporal_pattern_example_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_example" ADD CONSTRAINT "temporal_pattern_example_event_id_temporal_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."temporal_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_example" ADD CONSTRAINT "temporal_pattern_example_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD CONSTRAINT "temporal_pattern_hypothesis_created_from_learning_run_id_temporal_learning_run_id_fk" FOREIGN KEY ("created_from_learning_run_id") REFERENCES "public"."temporal_learning_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_query_log" ADD CONSTRAINT "temporal_pattern_query_log_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_review" ADD CONSTRAINT "temporal_pattern_review_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_seeded_run" ADD CONSTRAINT "temporal_pattern_seeded_run_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_seeded_run" ADD CONSTRAINT "temporal_pattern_seeded_run_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporal_pattern_step" ADD CONSTRAINT "temporal_pattern_step_pattern_id_temporal_pattern_hypothesis_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."temporal_pattern_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_temporal_evaluation_metric_run" ON "temporal_evaluation_metric" USING btree ("evaluation_run_id","metric_name","segment");--> statement-breakpoint
CREATE INDEX "idx_temporal_evaluation_run_config" ON "temporal_evaluation_run" USING btree ("config_hash");--> statement-breakpoint
CREATE INDEX "idx_temporal_evaluation_run_status" ON "temporal_evaluation_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_temporal_event_time_domain" ON "temporal_event" USING btree ("occurred_at","source_domain");--> statement-breakpoint
CREATE INDEX "idx_temporal_event_sim" ON "temporal_event" USING btree ("sim_run_id","fish_index","turn_index");--> statement-breakpoint
CREATE INDEX "idx_temporal_event_seeded" ON "temporal_event" USING btree ("seeded_by_pattern_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_event_embedding" ON "temporal_event" USING btree ("embedding_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_event_signature" ON "temporal_event" USING btree ("canonical_signature","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_event_source" ON "temporal_event" USING btree ("projection_run_id","source_table","source_pk","event_type");--> statement-breakpoint
CREATE INDEX "idx_temporal_learning_run_snapshot" ON "temporal_learning_run" USING btree ("input_snapshot_hash","pattern_version");--> statement-breakpoint
CREATE INDEX "idx_temporal_learning_run_status" ON "temporal_learning_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_temporal_learning_run_domain" ON "temporal_learning_run" USING btree ("source_domain","started_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_edge_pattern" ON "temporal_pattern_edge" USING btree ("pattern_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_pattern_edge" ON "temporal_pattern_edge" USING btree ("pattern_id","from_signature","to_signature");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_edge_transition" ON "temporal_pattern_edge" USING btree ("from_signature","to_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_pattern_example" ON "temporal_pattern_example" USING btree ("pattern_id","event_id","role");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_example_pattern" ON "temporal_pattern_example" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_example_event" ON "temporal_pattern_example" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_pattern_hash_version" ON "temporal_pattern_hypothesis" USING btree ("pattern_hash","pattern_version");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_visibility" ON "temporal_pattern_hypothesis" USING btree ("status","terminal_status","source_domain");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_learning_run" ON "temporal_pattern_hypothesis" USING btree ("created_from_learning_run_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_query_log_consumer" ON "temporal_pattern_query_log" USING btree ("consumer","created_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_query_log_pattern" ON "temporal_pattern_query_log" USING btree ("pattern_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_review_pattern" ON "temporal_pattern_review" USING btree ("pattern_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_pattern_seeded_run" ON "temporal_pattern_seeded_run" USING btree ("pattern_id","sim_run_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_seeded_run_sim" ON "temporal_pattern_seeded_run" USING btree ("sim_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_temporal_pattern_step" ON "temporal_pattern_step" USING btree ("pattern_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_temporal_pattern_step_signature" ON "temporal_pattern_step" USING btree ("event_signature");--> statement-breakpoint
CREATE INDEX "idx_temporal_projection_run_scope" ON "temporal_projection_run" USING btree ("source_scope","created_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_projection_run_snapshot" ON "temporal_projection_run" USING btree ("input_snapshot_hash");--> statement-breakpoint
CREATE INDEX "idx_temporal_projection_run_status" ON "temporal_projection_run" USING btree ("status");