/**
 * SPEC-TH-025 AC-2 — patch without redeploy.
 *
 * This file keeps only the executable acceptance criterion already shipped.
 * The remaining DRAFT ACs stay captured in the spec, not as placeholder tests.
 */

import { describe, expect, it } from "vitest";
import { getConfig } from "./helpers/runtime-config";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

describe("SPEC-TH-025 AC-2 — runtime config patch without redeploy", () => {
  it(
    "patches thalamus.budgets.deep.maxCost and preserves sibling budget fields on GET",
    async () => {
      await fetch(`${BASE}/api/config/runtime/thalamus.budgets`, {
        method: "DELETE",
      });

      const patchRes = await fetch(`${BASE}/api/config/runtime/thalamus.budgets`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deep: { maxCost: 0.25 } }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as {
        value: {
          deep: {
            maxCost: number;
            maxIterations: number;
            confidenceTarget: number;
          };
          simple: { maxCost: number };
        };
      };
      expect(patched.value.deep.maxCost).toBe(0.25);
      expect(patched.value.deep.maxIterations).toBe(8);
      expect(patched.value.deep.confidenceTarget).toBe(0.8);
      expect(patched.value.simple.maxCost).toBe(0.03);

      const read = await getConfig("thalamus.budgets");
      expect(read.value.deep).toEqual(
        expect.objectContaining({
          maxCost: 0.25,
          maxIterations: 8,
          confidenceTarget: 0.8,
        }),
      );

      await fetch(`${BASE}/api/config/runtime/thalamus.budgets`, {
        method: "DELETE",
      });
    },
  );
});
