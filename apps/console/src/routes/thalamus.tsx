import { createFileRoute } from "@tanstack/react-router";
import { ThalamusEntry } from "@/features/thalamus";

export const Route = createFileRoute("/thalamus")({
  component: ThalamusEntry,
});
