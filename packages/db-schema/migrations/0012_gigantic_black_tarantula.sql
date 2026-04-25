CREATE TABLE "sim_review_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"swarm_id" bigint NOT NULL,
	"sim_run_id" bigint,
	"scope" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace_excerpt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sim_review_evidence" ADD CONSTRAINT "sim_review_evidence_swarm_id_sim_swarm_id_fk" FOREIGN KEY ("swarm_id") REFERENCES "public"."sim_swarm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_review_evidence" ADD CONSTRAINT "sim_review_evidence_sim_run_id_sim_run_id_fk" FOREIGN KEY ("sim_run_id") REFERENCES "public"."sim_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sim_review_evidence_swarm" ON "sim_review_evidence" USING btree ("swarm_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sim_review_evidence_run" ON "sim_review_evidence" USING btree ("sim_run_id");
