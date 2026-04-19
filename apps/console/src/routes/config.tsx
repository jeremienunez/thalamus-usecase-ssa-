import { createFileRoute } from "@tanstack/react-router";
import { ConfigEntry } from "@/features/config";

export const Route = createFileRoute("/config")({
  component: ConfigEntry,
});
