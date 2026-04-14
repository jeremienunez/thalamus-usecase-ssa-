CREATE TABLE IF NOT EXISTS "source" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"category" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" bigint NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"abstract" text,
	"body" text,
	"authors" text[],
	"url" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"score" real,
	"raw_metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_item" ADD CONSTRAINT "source_item_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_source_kind_last_fetched" ON "source" ("kind","last_fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_source_item_external" ON "source_item" ("source_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_source_item_source_published" ON "source_item" ("source_id","published_at");