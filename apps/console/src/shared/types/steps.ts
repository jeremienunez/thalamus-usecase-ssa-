// Inlined from @interview/shared/observability/steps.ts — the shared barrel
// drags in prom-client + pino which are Node-only. Frontend gets a copy.
export type StepName =
  | "cycle" | "planner" | "cortex" | "nano.call"
  | "fetch.osint" | "fetch.field" | "curator.dedup"
  | "kg.write" | "guardrail.breach" | "reflexion"
  | "swarm" | "fish.spawn" | "fish.perturb" | "fish.turn"
  | "fish.memory.read" | "fish.memory.write"
  | "aggregator" | "suggestion.emit" | "swarm.fail-soft";

export type StepEntry =
  | { instantaneous: true; terminal: string; frames?: never; error?: never }
  | { instantaneous?: false; frames: string[]; terminal: string; error: string };

export const STEP_REGISTRY: Readonly<Record<StepName, StepEntry>> = Object.freeze({
  cycle:             { frames: ["🧠", "💭", "🧠", "💫"], terminal: "🏁", error: "💥" },
  planner:           { frames: ["🗺️", "🧭", "🗺️", "📐"], terminal: "📍", error: "⚠️" },
  cortex:            { frames: ["🧩", "⚙️", "🧩", "🔩"], terminal: "✅", error: "❌" },
  "nano.call":       { frames: ["💭", "💬", "💭", "🗯️"], terminal: "✨", error: "💔" },
  "fetch.osint":     { frames: ["🛰️", "📶", "🛰️", "🌐"], terminal: "📥", error: "🕳️" },
  "fetch.field":     { frames: ["📡", "⚡", "📡", "🔭"], terminal: "📥", error: "🕳️" },
  "curator.dedup":   { frames: ["🧹", "🧽", "🧹", "✂️"], terminal: "🧴", error: "⚠️" },
  "kg.write":        { frames: ["📝", "✍️", "📝", "🖋️"], terminal: "📚", error: "❌" },
  "guardrail.breach":{ terminal: "🚧", instantaneous: true },
  reflexion:         { frames: ["🔁", "🌀", "🔁", "♻️"], terminal: "🪞", error: "⚠️" },
  swarm:             { frames: ["🐟", "🐠", "🐡", "🦈"], terminal: "🏆", error: "🚨" },
  "fish.spawn":      { frames: ["🐠", "🫧", "🐠", "💦"], terminal: "🐟", error: "💀" },
  "fish.perturb":    { frames: ["🎲", "🌪️", "🎲", "⚡"], terminal: "🎯", error: "⚠️" },
  "fish.turn":       { frames: ["💧", "🌊", "💧", "🫧"], terminal: "🎣", error: "💔" },
  "fish.memory.read":{ frames: ["🧠", "🔍", "🧠", "📖"], terminal: "📚", error: "⚠️" },
  "fish.memory.write":{ frames: ["🫧", "💾", "🫧", "📥"], terminal: "💽", error: "⚠️" },
  aggregator:        { frames: ["🕸️", "🧬", "🕸️", "🔬"], terminal: "🎯", error: "⚠️" },
  "suggestion.emit": { terminal: "💡", instantaneous: true },
  "swarm.fail-soft": { terminal: "🚨", instantaneous: true },
});
