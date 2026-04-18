/**
 * SsaActionSchemaProvider — SSA action Zod schema.
 *
 * TODO(Plan 2 · B.5): move turnActionSchema + godEventSchema +
 *   perturbationSchema + seedRefsSchema + launchSwarmSchema verbatim from
 *   packages/sweep/src/sim/schema.ts. Kernel schema.ts retains only
 *   buildTurnResponseSchema + genericLaunchSwarmSchema.
 *
 * Until B.5 lands, this file is an empty stub; the kernel still consumes the
 * flat SSA schema at its legacy location. Do NOT wire in the container yet.
 */

import type { z } from "zod";
import type { SimActionSchemaProvider } from "@interview/sweep";

// TODO(B.5): import { turnActionSchema } from "./_moved-from-sweep-schema";
const placeholderSchema: z.ZodTypeAny = null as unknown as z.ZodTypeAny;

export class SsaActionSchemaProvider implements SimActionSchemaProvider {
  actionSchema(): z.ZodTypeAny {
    // TODO(B.5): return turnActionSchema;
    return placeholderSchema;
  }
}
