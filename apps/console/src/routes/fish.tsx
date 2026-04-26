import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const FishOperatorEntry = lazy(() =>
  import("@/features/fish-operator").then((m) => ({ default: m.FishOperatorEntry })),
);

export const Route = createFileRoute("/fish")({
  component: FishOperatorEntry,
});
