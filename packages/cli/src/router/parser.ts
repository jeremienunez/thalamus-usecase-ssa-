import type { RouterPlan } from "./schema";

type Verb = "query" | "telemetry" | "logs" | "graph" | "accept" | "explain";
const VERBS: ReadonlySet<Verb> = new Set(["query", "telemetry", "logs", "graph", "accept", "explain"]);
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export function parseExplicitCommand(input: string): RouterPlan | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawVerb, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!VERBS.has(rawVerb as Verb)) return null;
  const verb = rawVerb as Verb;
  const args = rest.join(" ").trim();

  switch (verb) {
    case "query":
      if (!args) return null;
      return { steps: [{ action: "query", q: args }], confidence: 1 };
    case "telemetry":
      if (!args) return null;
      return { steps: [{ action: "telemetry", satId: args.split(/\s+/)[0] }], confidence: 1 };
    case "graph":
      if (!args) return null;
      return { steps: [{ action: "graph", entity: args }], confidence: 1 };
    case "accept":
      if (!args) return null;
      return { steps: [{ action: "accept", suggestionId: args.split(/\s+/)[0] }], confidence: 1 };
    case "explain":
      if (!args) return null;
      return { steps: [{ action: "explain", findingId: args.split(/\s+/)[0] }], confidence: 1 };
    case "logs": {
      const flags = Object.fromEntries(
        args.split(/\s+/).filter(Boolean).map((kv) => {
          const [k, v] = kv.split("=");
          return [k, v];
        }),
      );
      const level = flags.level && (LOG_LEVELS as readonly string[]).includes(flags.level)
        ? (flags.level as typeof LOG_LEVELS[number]) : undefined;
      const service = flags.service;
      return { steps: [{ action: "logs", ...(level && { level }), ...(service && { service }) }], confidence: 1 };
    }
  }
}
