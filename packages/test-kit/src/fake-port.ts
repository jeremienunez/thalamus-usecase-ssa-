const SAFE_MISSING_KEYS = new Set([
  "then",
  "inspect",
  "toJSON",
  "constructor",
]);

export function fakePort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({ ...overrides } as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === "symbol" || SAFE_MISSING_KEYS.has(String(prop))) {
        return undefined;
      }
      throw new Error(
        `fakePort: method "${String(prop)}" was called but not overridden. ` +
          `Declare it in your overrides: fakePort<T>({ ${String(prop)}: typedSpy<T["${String(prop)}"]>() })`,
      );
    },
  });
}

export const fakeRepo = fakePort;
