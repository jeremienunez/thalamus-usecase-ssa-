CREATE TABLE IF NOT EXISTS "itu_filing" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filing_id" text NOT NULL,
	"constellation_name" text NOT NULL,
	"administration" text NOT NULL,
	"operator_name" text,
	"operator_country" text,
	"orbit_class" text NOT NULL,
	"orbit_details" text,
	"altitude_km" integer,
	"inclination_deg" integer,
	"planned_satellites" integer,
	"frequency_bands" text[],
	"filing_date" timestamp with time zone,
	"status" text,
	"source_url" text,
	"raw" jsonb,
	"source" text DEFAULT 'curated' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_itu_filing_id" ON "itu_filing" ("source","filing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_itu_constellation" ON "itu_filing" ("constellation_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_itu_operator_country" ON "itu_filing" ("operator_country");