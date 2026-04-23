import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const ConfigEntry = lazy(() =>
  import("@/features/config").then((module) => ({ default: module.ConfigEntry })),
);

export const Route = createFileRoute("/config")({
  component: ConfigEntry,
});
