CREATE TABLE IF NOT EXISTS "research_cycle_finding" (
	"research_cycle_id" bigint NOT NULL,
	"research_finding_id" bigint NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"is_dedup_hit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_cycle_finding_research_cycle_id_research_finding_id_pk" PRIMARY KEY("research_cycle_id","research_finding_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_cycle_finding" ADD CONSTRAINT "research_cycle_finding_research_cycle_id_research_cycle_id_fk" FOREIGN KEY ("research_cycle_id") REFERENCES "public"."research_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_cycle_finding" ADD CONSTRAINT "research_cycle_finding_research_finding_id_research_finding_id_fk" FOREIGN KEY ("research_finding_id") REFERENCES "public"."research_finding"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rcf_finding" ON "research_cycle_finding" ("research_finding_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rcf_cycle_created" ON "research_cycle_finding" ("research_cycle_id","created_at");