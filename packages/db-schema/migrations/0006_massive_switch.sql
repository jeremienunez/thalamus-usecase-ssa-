CREATE TABLE IF NOT EXISTS "space_weather_forecast" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"epoch" timestamp with time zone NOT NULL,
	"f107" real,
	"ap_index" real,
	"kp_index" real,
	"sunspot_number" real,
	"issued_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_space_weather_src_epoch_issue" ON "space_weather_forecast" ("source","epoch","issued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_space_weather_epoch" ON "space_weather_forecast" ("epoch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_space_weather_source_epoch" ON "space_weather_forecast" ("source","epoch");