import { createFileRoute } from "@tanstack/react-router";
import { OpsEntry } from "@/features/ops";

export const Route = createFileRoute("/ops")({
  component: OpsEntry,
});
