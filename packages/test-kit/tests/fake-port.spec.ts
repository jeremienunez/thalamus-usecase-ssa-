import { describe, expect, it } from "vitest";
import { fakePort, fakeRepo, typedSpy } from "../src";

interface SamplePort {
  list(ids: number[]): Promise<string[]>;
}

describe("@interview/test-kit fakePort", () => {
  it("throws when an unimplemented method is accessed", () => {
    const port = fakePort<SamplePort>();

    expect(() => port.list).toThrow(
      'fakePort: method "list" was called but not overridden.',
    );
  });

  it("returns provided overrides with their declared signature", async () => {
    const list = typedSpy<SamplePort["list"]>();
    list.mockResolvedValue(["a", "b"]);
    const port = fakeRepo<SamplePort>({ list });

    await expect(port.list([1, 2])).resolves.toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledWith([1, 2]);
  });

  it("returns undefined on symbol access so framework introspection stays harmless", () => {
    const port = fakePort<SamplePort>();

    expect(Reflect.get(port, Symbol.toStringTag)).toBeUndefined();
  });
});
