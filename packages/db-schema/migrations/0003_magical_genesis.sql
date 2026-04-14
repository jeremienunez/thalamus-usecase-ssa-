CREATE TABLE IF NOT EXISTS "conjunction_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"primary_satellite_id" bigint NOT NULL,
	"secondary_satellite_id" bigint NOT NULL,
	"epoch" timestamp with time zone NOT NULL,
	"min_range_km" real NOT NULL,
	"relative_velocity_kmps" real,
	"probability_of_collision" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conjunction_event" ADD CONSTRAINT "conjunction_event_primary_satellite_id_satellite_id_fk" FOREIGN KEY ("primary_satellite_id") REFERENCES "public"."satellite"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conjunction_event" ADD CONSTRAINT "conjunction_event_secondary_satellite_id_satellite_id_fk" FOREIGN KEY ("secondary_satellite_id") REFERENCES "public"."satellite"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conjunction_epoch" ON "conjunction_event" ("epoch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conjunction_primary" ON "conjunction_event" ("primary_satellite_id","epoch");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conjunction_range" ON "conjunction_event" ("min_range_km");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conjunction_pc" ON "conjunction_event" ("probability_of_collision");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conjunction_pair_epoch" ON "conjunction_event" ("primary_satellite_id","secondary_satellite_id","epoch");