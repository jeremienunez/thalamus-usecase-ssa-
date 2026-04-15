import { createFileRoute } from "@tanstack/react-router";
import { OpsMode } from "@/modes/ops/OpsMode";

export const Route = createFileRoute("/ops")({
  component: OpsMode,
});
