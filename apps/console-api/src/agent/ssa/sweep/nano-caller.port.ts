/**
 * NanoCaller port (DIP)
 *
 * The SsaAuditProvider is a high-level policy (audit orchestration); the
 * underlying LLM transport (`callNanoWaves` in @interview/thalamus) is a
 * low-level detail. This port inverts that dependency: the provider
 * depends on `NanoCaller`, and the container wires a concrete adapter
 * around the thalamus function.
 *
 * Type-only imports from thalamus are fine — they do not cause runtime
 * module loading, only structural typing.
 */
import type { NanoRequest, NanoResponse } from "@interview/thalamus";

export interface NanoCaller {
  callWaves<T>(
    items: T[],
    buildRequest: (item: T) => NanoRequest,
  ): Promise<Array<NanoResponse & { index: number }>>;
}

export type { NanoRequest, NanoResponse };
