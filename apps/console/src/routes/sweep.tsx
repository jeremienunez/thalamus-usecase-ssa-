import { createFileRoute } from "@tanstack/react-router";
import { SweepEntry } from "@/features/sweep";

export const Route = createFileRoute("/sweep")({
  component: SweepEntry,
});
