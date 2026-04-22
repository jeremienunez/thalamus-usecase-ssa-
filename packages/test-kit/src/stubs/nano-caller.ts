import type { NanoRequest, NanoResponse } from "@interview/thalamus";
import { typedSpy } from "../typed-spy";

export interface StubNanoCallerPort {
  callWaves<T>(
    items: T[],
    buildRequest: (item: T) => NanoRequest,
  ): Promise<Array<NanoResponse & { index: number }>>;
}

export function stubNanoCaller() {
  const callWaves = typedSpy<StubNanoCallerPort["callWaves"]>();
  callWaves.mockResolvedValue([]);
  return {
    callWaves,
    _spy: callWaves,
  };
}
