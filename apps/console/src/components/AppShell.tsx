import { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { LeftRail } from "./LeftRail";
import { TelemetryStrip } from "./TelemetryStrip";
import { CommandPalette } from "./CommandPalette";
import { ReplPanel, ReplProvider } from "./ReplPanel";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ReplProvider>
      <div className="flex h-full w-full flex-col bg-base text-primary">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <LeftRail />
          <main className="relative min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
        <TelemetryStrip />
        <CommandPalette />
        <ReplPanel />
      </div>
    </ReplProvider>
  );
}
