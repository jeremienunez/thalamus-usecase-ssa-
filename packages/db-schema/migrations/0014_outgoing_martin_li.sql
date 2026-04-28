ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "pattern_rate" real;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "best_component_signature" text;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "best_component_rate" real;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "sequence_lift_over_best_component" real;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "lead_time_ms_avg" integer;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "lead_time_ms_p50" integer;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "lead_time_ms_p95" integer;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "temporal_order_quality" text DEFAULT 'real_time_ordered' NOT NULL;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "contains_target_proxy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "temporal_pattern_hypothesis" ADD COLUMN "contains_singleton_only" boolean DEFAULT false NOT NULL;