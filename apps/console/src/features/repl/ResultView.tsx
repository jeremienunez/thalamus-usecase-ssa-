import type { BriefingUiAction, DispatchResult } from "@/features/repl/types";
import { ChatRender } from "./renderers/ChatRender";
import { BriefingRender } from "./renderers/BriefingRender";
import { TelemetryRender } from "./renderers/TelemetryRender";
import { LogTailRender } from "./renderers/LogTailRender";
import { GraphTreeRender } from "./renderers/GraphTreeRender";
import { WhyTreeRender } from "./renderers/WhyTreeRender";
import { ClarifyRender } from "./renderers/ClarifyRender";
import { PcEstimatorRender } from "./renderers/PcEstimatorRender";
import { ResolutionRender } from "./renderers/ResolutionRender";

export function ResultView({
  result,
  onFollowUp,
  onUiAction,
}: {
  result: DispatchResult;
  onFollowUp: (input: string) => void;
  onUiAction: (action: BriefingUiAction) => void;
}) {
  switch (result.kind) {
    case "briefing":
      return (
        <BriefingRender
          r={result}
          onFollowUp={onFollowUp}
          onUiAction={onUiAction}
        />
      );
    case "telemetry":
      return <TelemetryRender r={result} />;
    case "logs":
      return <LogTailRender r={result} />;
    case "graph":
      return <GraphTreeRender r={result} />;
    case "why":
      return <WhyTreeRender r={result} />;
    case "clarify":
      return <ClarifyRender r={result} onFollowUp={onFollowUp} />;
    case "resolution":
      return <ResolutionRender r={result} />;
    case "pc":
      return <PcEstimatorRender r={result} onFollowUp={onFollowUp} />;
    case "chat":
      return <ChatRender r={result} />;
  }
}
