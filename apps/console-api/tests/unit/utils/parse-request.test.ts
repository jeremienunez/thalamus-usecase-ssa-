import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseOrReply } from "../../../src/utils/parse-request";

function mockReply() {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

describe("parseOrReply", () => {
  it("returns parsed data and does not touch the reply on success", () => {
    const reply = mockReply();
    const schema = z.object({
      limit: z.coerce.number().int().positive(),
    });

    const parsed = parseOrReply({ limit: "5" }, schema, reply as never);

    expect(parsed).toEqual({ limit: 5 });
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("sends a 400 payload with flattened issue paths on failure", () => {
    const reply = mockReply();
    const schema = z.object({
      filters: z.object({
        minPc: z.number().min(0),
      }),
    });

    const parsed = parseOrReply(
      { filters: { minPc: -1 } },
      schema,
      reply as never,
    );

    expect(parsed).toBeNull();
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: "invalid request",
      issues: [{ path: "filters.minPc", message: "Number must be greater than or equal to 0" }],
    });
  });
});
