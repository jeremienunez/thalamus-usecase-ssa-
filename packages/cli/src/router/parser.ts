import type { RouterPlan } from "./schema";

type Verb = "query" | "telemetry" | "logs" | "graph" | "accept" | "explain" | "pc" | "candidates";
const VERBS: ReadonlySet<Verb> = new Set(["query", "telemetry", "logs", "graph", "accept", "explain", "pc", "candidates"]);
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
    case "pc":
      if (!args) return null;
      return { steps: [{ action: "pc", conjunctionId: args.split(/\s+/)[0] }], confidence: 1 };
    case "candidates": {
      if (!args) return null;
      const tokens = args.split(/\s+/).filter(Boolean);
      const norad = Number(tokens[0]);
      if (!Number.isFinite(norad) || norad <= 0) return null;
      const flags = Object.fromEntries(
        tokens.slice(1).map((kv) => {
          const [k, v] = kv.split("=");
          return [k, v];
        }),
      );
      const objectClass =
        flags.class && ["payload", "rocket_stage", "debris", "unknown"].includes(flags.class)
          ? (flags.class as "payload" | "rocket_stage" | "debris" | "unknown")
          : undefined;
      const limit = flags.limit ? Math.max(1, Math.min(100, Number(flags.limit))) : undefined;
      return {
        steps: [{
          action: "candidates",
          targetNoradId: norad,
          ...(objectClass && { objectClass }),
          ...(limit && { limit }),
        }],
        confidence: 1,
      };
    }
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
