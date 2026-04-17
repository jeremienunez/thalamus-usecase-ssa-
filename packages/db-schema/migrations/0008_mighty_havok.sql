CREATE TABLE IF NOT EXISTS "notam" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notam_id" text NOT NULL,
	"type" text NOT NULL,
	"facility" text,
	"state" text,
	"description" text NOT NULL,
	"creation_date" timestamp with time zone,
	"parsed_start_utc" timestamp with time zone,
	"parsed_end_utc" timestamp with time zone,
	"is_launch_related" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'faa-tfr' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notam_source_id" ON "notam" ("source","notam_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notam_launch" ON "notam" ("is_launch_related");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notam_window" ON "notam" ("parsed_start_utc","parsed_end_utc");