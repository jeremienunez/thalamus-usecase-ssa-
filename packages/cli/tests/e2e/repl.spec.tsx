import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";
import React from "react";
import { App } from "../../src/app";
import type { Adapters } from "../../src/router/dispatch";

// Ink 4's useInput calls stdin.ref()/unref(); ink-testing-library's Stdin stub
// lacks them. Patch prototype so the hook doesn't throw.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = EventEmitter.prototype as any;
if (typeof proto.ref !== "function") proto.ref = function ref() { return this; };
if (typeof proto.unref !== "function") proto.unref = function unref() { return this; };

describe("REPL e2e", () => {
  it("slash command → briefing render → accept", async () => {
    const adapters: Adapters = {
      thalamus: {
        runCycle: async () => ({
          findings: [
            {
              id: "F1",
              summary: "Risky",
              sourceClass: "FIELD",
              confidence: 0.9,
              evidenceRefs: ["S1"],
            },
          ],
          costUsd: 0.02,
        }),
      },
      telemetry: { start: async () => ({ distribution: {} }) },
      logs: { tail: () => [] },
      graph: { neighbourhood: async () => ({ root: "x", levels: [] }) },
      resolution: { accept: async () => ({ ok: true, delta: { findingId: "F1" } }) },
      why: { build: async () => ({ id: "F1", label: "x", kind: "finding", children: [] }) },
    };
    const { stdin: rawStdin, lastFrame } = render(
      <App
        adapters={adapters}
        interpret={async () => ({ plan: { steps: [], confidence: 0 }, costUsd: 0 })}
        etaEstimate={() => ({ status: "estimating" as const })}
        etaRecord={() => {}}
      />,
    );
    // Ink 4 uses the `readable` event + stdin.read() pattern; the testing
    // library's Stdin emits 'data' on write(). Bridge the two.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = rawStdin as any;
    let buf = "";
    s.read = () => {
      if (buf.length === 0) return null;
      const out = buf;
      buf = "";
      return out;
    };
    const writeChar = (data: string) => {
      buf += data;
      s.emit("readable");
    };
    const typeLine = async (line: string) => {
      for (const ch of line) {
        writeChar(ch);
        await new Promise((r) => setTimeout(r, 2));
      }
      writeChar("\r");
      await new Promise((r) => setTimeout(r, 300));
    };
    await new Promise((r) => setTimeout(r, 50));
    await typeLine("/query risk");
    expect(lastFrame()).toContain("F1");
    await typeLine("/accept F1");
    const f = lastFrame() ?? "";
    expect(f).toContain("F1");
  });
});
