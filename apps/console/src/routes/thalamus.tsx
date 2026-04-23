import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const ThalamusEntry = lazy(() =>
  import("@/features/thalamus").then((module) => ({ default: module.ThalamusEntry })),
);

export const Route = createFileRoute("/thalamus")({
  component: ThalamusEntry,
});
