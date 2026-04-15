import { createFileRoute } from "@tanstack/react-router";
import { ThalamusMode } from "@/modes/thalamus/ThalamusMode";

export const Route = createFileRoute("/thalamus")({
  component: ThalamusMode,
});
