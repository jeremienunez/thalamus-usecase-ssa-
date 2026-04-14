ALTER TABLE "research_finding" ALTER COLUMN "embedding" SET DATA TYPE halfvec(2048);--> statement-breakpoint
ALTER TABLE "sim_agent_memory" ALTER COLUMN "embedding" SET DATA TYPE halfvec(2048);--> statement-breakpoint
ALTER TABLE "conjunction_event" ADD COLUMN "primary_sigma_km" real;--> statement-breakpoint
ALTER TABLE "conjunction_event" ADD COLUMN "secondary_sigma_km" real;--> statement-breakpoint
ALTER TABLE "conjunction_event" ADD COLUMN "combined_sigma_km" real;--> statement-breakpoint
ALTER TABLE "conjunction_event" ADD COLUMN "hard_body_radius_m" real DEFAULT 20;--> statement-breakpoint
ALTER TABLE "conjunction_event" ADD COLUMN "pc_method" text;