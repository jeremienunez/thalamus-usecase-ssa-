import { describe, expect, it } from "vitest";
import { ReplChatBodySchema, ReplTurnBodySchema } from "../../../src/schemas/repl.schema";

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
