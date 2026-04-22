import type { CortexDataProvider, DataProviderFn } from "@interview/thalamus";
import { typedSpy } from "../typed-spy";

export type StubCortexLlm = CortexDataProvider & {
  _spies: Map<string, ReturnType<typeof typedSpy<DataProviderFn>>>;
};

export function stubCortexLlm(defaultRows: unknown[] = []): StubCortexLlm {
  const spies = new Map<string, ReturnType<typeof typedSpy<DataProviderFn>>>();
  const target: Record<string, DataProviderFn> = {};

  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (prop === "_spies") return spies;
      if (typeof prop !== "string") return undefined;

      if (!Reflect.has(currentTarget, prop)) {
        const spy = typedSpy<DataProviderFn>();
        spy.mockResolvedValue(defaultRows);
        Reflect.set(currentTarget, prop, spy, receiver);
        spies.set(prop, spy);
      }

      return Reflect.get(currentTarget, prop, receiver);
    },
  }) as StubCortexLlm;
}
