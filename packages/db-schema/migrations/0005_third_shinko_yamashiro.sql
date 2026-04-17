CREATE TABLE IF NOT EXISTS "amateur_track" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"candidate_norad_id" integer,
	"candidate_cospar" text,
	"tle_line_1" text,
	"tle_line_2" text,
	"orbit_regime_id" bigint,
	"observer_handle" text,
	"citation_url" text NOT NULL,
	"raw_excerpt" text,
	"resolved_satellite_id" bigint,
	"match_confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tle_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"satellite_id" bigint NOT NULL,
	"norad_id" integer NOT NULL,
	"epoch" timestamp with time zone NOT NULL,
	"mean_motion" real NOT NULL,
	"eccentricity" real NOT NULL,
	"inclination_deg" real NOT NULL,
	"raan" real,
	"arg_of_perigee" real,
	"mean_anomaly" real,
	"bstar" real,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "satellite" ADD COLUMN "norad_id" integer;--> statement-breakpoint
ALTER TABLE "satellite" ADD COLUMN "object_class" text;--> statement-breakpoint
ALTER TABLE "satellite" ADD COLUMN "opacity_score" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "satellite" ADD COLUMN "opacity_computed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amateur_track" ADD CONSTRAINT "amateur_track_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amateur_track" ADD CONSTRAINT "amateur_track_orbit_regime_id_orbit_regime_id_fk" FOREIGN KEY ("orbit_regime_id") REFERENCES "public"."orbit_regime"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amateur_track" ADD CONSTRAINT "amateur_track_resolved_satellite_id_satellite_id_fk" FOREIGN KEY ("resolved_satellite_id") REFERENCES "public"."satellite"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tle_history" ADD CONSTRAINT "tle_history_satellite_id_satellite_id_fk" FOREIGN KEY ("satellite_id") REFERENCES "public"."satellite"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_amateur_track_norad" ON "amateur_track" ("candidate_norad_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_amateur_track_cospar" ON "amateur_track" ("candidate_cospar");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_amateur_track_resolved" ON "amateur_track" ("resolved_satellite_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_amateur_track_observed" ON "amateur_track" ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tle_history_sat_epoch" ON "tle_history" ("satellite_id","epoch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tle_history_sat_epoch" ON "tle_history" ("satellite_id","epoch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tle_history_norad" ON "tle_history" ("norad_id");--> statement-breakpoint
ALTER TABLE "satellite" ADD CONSTRAINT "satellite_norad_id_unique" UNIQUE("norad_id");