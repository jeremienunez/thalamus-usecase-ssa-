// apps/console-api/src/types/repl-chat.types.ts
export type ReplFindingStreamView = {
  id: string;
  title: string;
  summary: string | null;
  cortex: string | null;
  urgency: string | null;
  confidence: number;
};

export type ReplFindingSummaryView = {
  id: string;
  title: string;
  summary: string | null;
  cortex: string | null;
  findingType: string | null;
  urgency: string | null;
  confidence: number;
};
