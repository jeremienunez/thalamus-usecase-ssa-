import { createFileRoute } from "@tanstack/react-router";
import { ConfigMode } from "@/modes/config/ConfigMode";

export const Route = createFileRoute("/config")({
  component: ConfigMode,
});
