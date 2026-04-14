export type StepName =
  | "cycle"
  | "planner"
  | "cortex"
  | "nano.call"
  | "fetch.osint"
  | "fetch.field"
  | "curator.dedup"
  | "kg.write"
  | "guardrail.breach"
  | "reflexion"
  | "swarm"
  | "fish.spawn"
  | "fish.perturb"
  | "fish.turn"
  | "fish.memory.read"
  | "fish.memory.write"
  | "aggregator"
  | "suggestion.emit"
  | "swarm.fail-soft";

export interface StepEntry {
  frames: string[];
  terminal: string;
  error?: string;
  instantaneous?: boolean;
}

export const STEP_REGISTRY: Readonly<Record<StepName, StepEntry>> = Object.freeze({
  cycle: { frames: ["🧠", "💭", "🧠", "💫"], terminal: "🏁", error: "💥" },
  planner: { frames: ["🗺️", "🧭", "🗺️", "📐"], terminal: "📍", error: "⚠️" },
  cortex: { frames: ["🧩", "⚙️", "🧩", "🔩"], terminal: "✅", error: "❌" },
  "nano.call": { frames: ["💭", "💬", "💭", "🗯️"], terminal: "✨", error: "💔" },
  "fetch.osint": { frames: ["🛰️", "📶", "🛰️", "🌐"], terminal: "📥", error: "🕳️" },
  "fetch.field": { frames: ["📡", "⚡", "📡", "🔭"], terminal: "📥", error: "🕳️" },
  "curator.dedup": { frames: ["🧹", "🧽", "🧹", "✂️"], terminal: "🧴", error: "⚠️" },
  "kg.write": { frames: ["📝", "✍️", "📝", "🖋️"], terminal: "📚", error: "❌" },
  "guardrail.breach": { frames: [], terminal: "🚧", instantaneous: true },
  reflexion: { frames: ["🔁", "🌀", "🔁", "♻️"], terminal: "🪞", error: "⚠️" },
  swarm: { frames: ["🐟", "🐠", "🐡", "🦈"], terminal: "🏆", error: "🚨" },
  "fish.spawn": { frames: ["🐠", "🫧", "🐠", "💦"], terminal: "🐟", error: "💀" },
  "fish.perturb": { frames: ["🎲", "🌪️", "🎲", "⚡"], terminal: "🎯", error: "⚠️" },
  "fish.turn": { frames: ["💧", "🌊", "💧", "🫧"], terminal: "🎣", error: "💔" },
  "fish.memory.read": { frames: ["🧠", "🔍", "🧠", "📖"], terminal: "📚", error: "⚠️" },
  "fish.memory.write": { frames: ["🫧", "💾", "🫧", "📥"], terminal: "💽", error: "⚠️" },
  aggregator: { frames: ["🕸️", "🧬", "🕸️", "🔬"], terminal: "🎯", error: "⚠️" },
  "suggestion.emit": { frames: [], terminal: "💡", instantaneous: true },
  "swarm.fail-soft": { frames: [], terminal: "🚨", instantaneous: true },
});
