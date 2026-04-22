import { describe, expect, expectTypeOf, it } from "vitest";
import { typedSpy } from "../src";

describe("@interview/test-kit typedSpy", () => {
  it("binds mock arguments and return type to the target function signature", async () => {
    type Fn = (
      id: bigint,
      opts: { dryRun: boolean },
    ) => Promise<{ ok: boolean }>;

    const spy = typedSpy<Fn>();
    spy.mockResolvedValue({ ok: true });

    const result = await spy(7n, { dryRun: false });

    expect(result).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(7n, { dryRun: false });
    expectTypeOf(spy.mock.calls[0]).toEqualTypeOf<
      [bigint, { dryRun: boolean }]
    >();
    expectTypeOf<Awaited<ReturnType<Fn>>>().toEqualTypeOf<{ ok: boolean }>();
  });
});
