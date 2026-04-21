/**
 * Default NanoCaller adapter — wraps @interview/thalamus `callNanoWaves`.
 *
 * This file is the ONLY place in the SSA audit stack that has a runtime
 * dependency on the thalamus module. Tests replace it with a fake; the
 * container wires this adapter in production.
 */
import { callNanoWaves } from "@interview/thalamus";
import type { NanoCaller } from "./nano-caller.port";

export const defaultNanoCaller: NanoCaller = {
  callWaves(items, buildRequest) {
    return callNanoWaves(items, buildRequest);
  },
};
