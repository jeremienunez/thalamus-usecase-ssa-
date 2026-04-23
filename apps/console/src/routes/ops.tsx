import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const OpsEntry = lazy(() =>
  import("@/features/ops").then((module) => ({ default: module.OpsEntry })),
);

export const Route = createFileRoute("/ops")({
  component: OpsEntry,
});
