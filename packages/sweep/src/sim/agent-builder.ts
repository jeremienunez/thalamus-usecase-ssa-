import { createLogger } from "@interview/shared/observability";
import type {
  SimAgentPersonaComposer,
  SimRuntimeStore,
  SimSubjectProvider,
  SimSubjectSnapshot,
} from "./ports";

const logger = createLogger("sim-agent-builder");

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export interface BuildAgentDeps {
  store: SimRuntimeStore;
  subjects: SimSubjectProvider;
  persona: SimAgentPersonaComposer;
}

export interface BuildAgentOpts {
  simRunId: number;
  subjectId: number;
  agentIndex: number;
  subjectKind?: string;
  riskProfile?: RiskProfile;
  constraintOverrides?: Record<string, unknown>;
  negotiationFraming?: boolean;
}

export interface BuildAgentResult {
  agentId: number;
  subjectSnapshot: SimSubjectSnapshot;
}

export async function buildSimAgent(
  deps: BuildAgentDeps,
  opts: BuildAgentOpts,
): Promise<BuildAgentResult> {
  const subject = await deps.subjects.getSubject({
    kind: opts.subjectKind ?? "subject",
    id: opts.subjectId,
  });

  const composed = deps.persona.compose(subject, {
    riskProfile: opts.riskProfile,
    negotiationFraming: opts.negotiationFraming ?? false,
    constraintOverrides: opts.constraintOverrides,
  });

  const agentId = await deps.store.insertAgent({
    simRunId: opts.simRunId,
    subjectId: opts.subjectId,
    agentIndex: opts.agentIndex,
    persona: composed.persona,
    goals: composed.goals,
    constraints: composed.constraints,
  });

  logger.debug(
    {
      simRunId: opts.simRunId,
      subjectId: opts.subjectId,
      agentIndex: opts.agentIndex,
    },
    "built sim_agent",
  );

  return {
    agentId,
    subjectSnapshot: subject,
  };
}
