import { createFileRoute } from "@tanstack/react-router";
import { SweepMode } from "@/modes/sweep/SweepMode";

export const Route = createFileRoute("/sweep")({
  component: SweepMode,
});
