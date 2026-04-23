import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const SweepEntry = lazy(() =>
  import("@/features/sweep").then((module) => ({ default: module.SweepEntry })),
);

export const Route = createFileRoute("/sweep")({
  component: SweepEntry,
});
