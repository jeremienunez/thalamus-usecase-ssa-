ALTER TABLE "launch" ADD COLUMN "external_launch_id" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "operator_name" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "operator_country" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "pad_name" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "pad_location" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "planned_net" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "planned_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "planned_window_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "orbit_name" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "mission_name" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "mission_description" text;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "rideshare" boolean;--> statement-breakpoint
ALTER TABLE "launch" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_launch_external_id" ON "launch" ("external_launch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_launch_pad" ON "launch" ("pad_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_launch_planned_net" ON "launch" ("planned_net");