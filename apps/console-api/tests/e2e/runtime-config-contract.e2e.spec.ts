/**
 * HTTP contract tests for /api/config/runtime/* — error paths + round-trip.
 *
 * No LLM calls, no kernel side effects. Each spec resets every registered
 * domain in afterEach because the e2e harness runs singleFork (see
 * apps/console-api/vitest.config.ts) and Redis override state leaks.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  patchConfig,
  getConfig,
  resetConfig,
  resetAllConfig,
  getAllConfig,
} from "./helpers/runtime-config";
import { RUNTIME_CONFIG_DOMAINS } from "@interview/shared/config";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

describe("runtime-config HTTP contract", () => {
  afterEach(async () => {
    await resetAllConfig();
  });

  it("given an unregistered domain, when GET/PATCH/DELETE is called, then each responds 404 with a typed error", async () => {
    const domain = "thalamus.imaginary";
    const expected = { error: `unknown domain: ${domain}` };

    const getRes = await fetch(`${BASE}/api/config/runtime/${domain}`);
    expect(getRes.status).toBe(404);
    expect(await getRes.json()).toEqual(expected);

    const patchRes = await patchConfig(domain, { anything: 1 });
    expect(patchRes.status).toBe(404);
    expect(await patchRes.json()).toEqual(expected);

    const delRes = await resetConfig(domain);
    expect(delRes.status).toBe(404);
    expect(await delRes.json()).toEqual(expected);
  });

  it("given a registered domain, when PATCH body contains an unknown field, then the response is 400 naming the field", async () => {
    const res = await patchConfig("thalamus.planner", { bogusField: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('unknown field "bogusField"');
  });

  it("given wrong-typed patch values, when PATCH is called, then each field rejects with a kind-specific 400", async () => {
    const numRes = await patchConfig("thalamus.planner", {
      maxCortices: "eight",
    });
    expect(numRes.status).toBe(400);
    expect(((await numRes.json()) as { error: string }).error).toMatch(
      /expected finite number/,
    );

    const boolRes = await patchConfig("thalamus.planner", {
      mandatoryStrategist: "yes",
    });
    expect(boolRes.status).toBe(400);
    expect(((await boolRes.json()) as { error: string }).error).toMatch(
      /expected boolean/,
    );

    const arrRes = await patchConfig("thalamus.planner", {
      forcedCortices: "launch_scout",
    });
    expect(arrRes.status).toBe(400);
    expect(((await arrRes.json()) as { error: string }).error).toMatch(
      /expected string\[\]/,
    );
  });

  it("given a json-kind field, when PATCH is round-tripped through GET, then the value is preserved verbatim", async () => {
    const nested = { a: { b: [1, 2, 3], c: true } };
    const patch1 = await patchConfig("thalamus.cortex", { overrides: nested });
    expect(patch1.status).toBe(200);
    const read1 = await getConfig("thalamus.cortex");
    expect(read1.value.overrides).toEqual(nested);

    const patch2 = await patchConfig("thalamus.cortex", {
      overrides: "sentinel-string",
    });
    expect(patch2.status).toBe(200);
    const read2 = await getConfig("thalamus.cortex");
    expect(read2.value.overrides).toBe("sentinel-string");
  });

  it("given the server is up, when GET /api/config/runtime is called, then domains has the 9 registered keys with contract shape", async () => {
    const { domains } = await getAllConfig();
    expect(new Set(Object.keys(domains))).toEqual(
      new Set(RUNTIME_CONFIG_DOMAINS),
    );
    expect(Object.keys(domains)).toHaveLength(9);
    for (const entry of Object.values(domains)) {
      expect(entry).toEqual(
        expect.objectContaining({
          value: expect.any(Object),
          defaults: expect.any(Object),
          schema: expect.any(Object),
          hasOverrides: expect.any(Boolean),
        }),
      );
    }
  });
});
