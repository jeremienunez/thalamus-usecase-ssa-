import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { TelemetryStrip } from "@/features/ops/TelemetryStrip";
import { CommandPalette } from "./CommandPalette";
import { ReplPanel } from "@/features/repl/ReplPanel";
import { ReplProvider } from "@/features/repl/ReplProvider";
import { ErrorBoundary } from "./ErrorBoundary";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ReplProvider>
      <div className="flex h-full w-full flex-col bg-base text-primary">
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
