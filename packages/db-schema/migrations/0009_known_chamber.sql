CREATE TABLE IF NOT EXISTS "fragmentation_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"parent_norad_id" integer,
	"parent_name" text NOT NULL,
	"parent_operator_country" text,
	"date_utc" timestamp with time zone NOT NULL,
	"regime_name" text,
	"fragments_cataloged" integer,
	"parent_mass_kg" real,
	"event_type" text NOT NULL,
	"cause" text,
	"source_url" text,
	"source" text DEFAULT 'curated' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fragmentation_parent_date" ON "fragmentation_event" ("parent_name","date_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fragmentation_date" ON "fragmentation_event" ("date_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fragmentation_regime" ON "fragmentation_event" ("regime_name");