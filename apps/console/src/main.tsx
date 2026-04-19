import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { FullPaneFallback } from "@/shared/ui/Skeleton";
import { AppProviders, buildDefaultAdapters } from "@/providers/AppProviders";
import "./styles/globals.css";

const adapters = buildDefaultAdapters();

const router = createRouter({
  routeTree,
  context: { queryClient: adapters.queryClient },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProviders adapters={adapters}>
        <Suspense fallback={<FullPaneFallback label="LOADING CONSOLE" />}>
          <RouterProvider router={router} />
        </Suspense>
      </AppProviders>
    </ErrorBoundary>
  </React.StrictMode>,
);
