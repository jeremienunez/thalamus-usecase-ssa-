import { ReactNode, useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { TelemetryStrip } from "@/features/ops/TelemetryStrip";
import { CommandPalette } from "./CommandPalette";
import { ReplPanel } from "@/features/repl/ReplPanel";
import { ReplProvider } from "@/features/repl/ReplProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUiStore } from "./uiStore";

const DRAWER_PREFIX_BY_MODE: Record<string, string> = {
  ops: "sat:",
  thalamus: "kg:",
  sweep: "f:",
  config: "cfg:",
};

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ReplProvider>
      <DrawerRouteGuard />
      <div className="flex h-full w-full flex-col bg-base text-primary [background-image:radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.08),transparent_28rem),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_16rem)]">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <LeftRail />
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
        <ErrorBoundary fallback={null}>
          <TelemetryStrip />
        </ErrorBoundary>
        <CommandPalette />
        <ErrorBoundary fallback={null}>
          <ReplPanel />
        </ErrorBoundary>
      </div>
    </ReplProvider>
  );
}

function DrawerRouteGuard() {
  const { location } = useRouterState();
  const drawerId = useUiStore((s) => s.drawerId);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const mode = location.pathname.split("/")[1] ?? "ops";
  const expectedPrefix = DRAWER_PREFIX_BY_MODE[mode];

  useEffect(() => {
    if (!drawerId) return;
    if (!expectedPrefix || !drawerId.startsWith(expectedPrefix)) closeDrawer();
  }, [closeDrawer, drawerId, expectedPrefix]);

  return null;
}
