import { describe, expect, it } from "vitest";
import {
  ReplChatBodySchema,
  ReplFollowUpRunBodySchema,
  ReplTurnBodySchema,
} from "../../../src/schemas/repl.schema";

describe("ReplChatBodySchema", () => {
  it("trims input and rejects blank content", () => {
    expect(ReplChatBodySchema.parse({ input: "  status meo  " })).toEqual({
      input: "status meo",
    });
    expect(ReplChatBodySchema.safeParse({ input: "   " }).success).toBe(false);
  });
});

describe("ReplTurnBodySchema", () => {
  it("defaults sessionId to anon", () => {
    expect(ReplTurnBodySchema.parse({ input: "track yaogan" })).toEqual({
      input: "track yaogan",
      sessionId: "anon",
    });
  });

  it("rejects blank session ids and blank input", () => {
    expect(ReplTurnBodySchema.safeParse({ input: "ok", sessionId: "" }).success).toBe(false);
    expect(ReplTurnBodySchema.safeParse({ input: "   " }).success).toBe(false);
  });
});

describe("ReplFollowUpRunBodySchema", () => {
  it("accepts a valid selected follow-up payload", () => {
    expect(
      ReplFollowUpRunBodySchema.parse({
        query: "  verify conjunction  ",
        parentCycleId: " cyc:42 ",
        item: {
          followupId: "fu:1",
          kind: "sim_pc_verification",
          auto: false,
          title: "Verify conjunction",
          rationale: "Need one more pass",
          score: 0.9,
          gateScore: 0.7,
          costClass: "medium",
          reasonCodes: ["needs_monitoring"],
          target: {
            entityType: "conjunction_event",
            entityId: "41",
            refs: { conjunctionId: "41" },
          },
        },
      }),
    ).toEqual({
      query: "verify conjunction",
      parentCycleId: "cyc:42",
      item: {
        followupId: "fu:1",
        kind: "sim_pc_verification",
        auto: false,
        title: "Verify conjunction",
        rationale: "Need one more pass",
        score: 0.9,
        gateScore: 0.7,
        costClass: "medium",
        reasonCodes: ["needs_monitoring"],
        target: {
          entityType: "conjunction_event",
          entityId: "41",
          refs: { conjunctionId: "41" },
        },
      },
    });
  });

  it("rejects blank query, blank parentCycleId, and invalid costClass", () => {
    expect(
      ReplFollowUpRunBodySchema.safeParse({
        query: "   ",
        parentCycleId: "cyc:42",
        item: {
          followupId: "fu:1",
          kind: "sim_pc_verification",
          auto: false,
          title: "Verify conjunction",
          rationale: "Need one more pass",
          score: 0.9,
          gateScore: 0.7,
          costClass: "high",
          reasonCodes: ["needs_monitoring"],
        },
      }).success,
    ).toBe(false);
    expect(
      ReplFollowUpRunBodySchema.safeParse({
        query: "verify conjunction",
        parentCycleId: "   ",
        item: {
          followupId: "fu:1",
          kind: "sim_pc_verification",
          auto: false,
          title: "Verify conjunction",
          rationale: "Need one more pass",
          score: 0.9,
          gateScore: 0.7,
          costClass: "medium",
          reasonCodes: ["needs_monitoring"],
        },
      }).success,
    ).toBe(false);
  });
});
