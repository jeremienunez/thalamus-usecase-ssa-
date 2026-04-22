import { vi } from "vitest";

export function typedSpy<Fn extends (...args: never[]) => unknown>() {
  return vi.fn<Fn>();
}
