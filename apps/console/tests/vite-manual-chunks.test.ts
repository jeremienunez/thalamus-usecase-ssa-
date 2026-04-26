import { describe, expect, it } from "vitest";
import { consoleManualChunks } from "../manual-chunks";

describe("consoleManualChunks", () => {
  it("keeps 3D, graph, and shell dependencies in separate route-level chunks", () => {
    expect(
      consoleManualChunks("/repo/node_modules/@react-three/fiber/dist/index.js"),
    ).toBe("vendor-3d");
    expect(consoleManualChunks("/repo/node_modules/three/build/three.module.js")).toBe(
      "vendor-3d",
    );
    expect(consoleManualChunks("/repo/node_modules/sigma/build/sigma.js")).toBe(
      "vendor-graph",
    );
    expect(
      consoleManualChunks("/repo/node_modules/graphology/dist/graphology.js"),
    ).toBe("vendor-graph");
    expect(
      consoleManualChunks("/repo/node_modules/@tanstack/react-router/dist/index.js"),
    ).toBe("vendor-shell");
  });

  it("leaves app modules and unrelated dependencies to Rollup defaults", () => {
    expect(consoleManualChunks("/repo/apps/console/src/features/ops/OpsScene.tsx")).toBe(
      undefined,
    );
    expect(consoleManualChunks("/repo/node_modules/satellite.js/dist/satellite.js")).toBe(
      undefined,
    );
  });
});
