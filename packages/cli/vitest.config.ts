import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * CLI-local vitest config — mirrors the workspace aliases from
 * vitest.workspace.ts so `pnpm --filter @interview/cli test` can resolve
 * subpath imports (e.g. `@interview/shared/observability`) the same way the
 * top-level workspace runner does.
 */
const root = resolve(__dirname, "..", "..");
const alias = {
  "@interview/shared/observability": resolve(
    root,
    "packages/shared/src/observability/index.ts",
  ),
  "@interview/shared/enum": resolve(root, "packages/shared/src/enum/index.ts"),
  "@interview/shared/utils": resolve(
    root,
    "packages/shared/src/utils/index.ts",
  ),
  "@interview/shared/types": resolve(root, "packages/shared/src/types"),
  "@interview/shared/schemas": resolve(root, "packages/shared/src/schemas"),
  "@interview/shared": resolve(root, "packages/shared/src/index.ts"),
  "@interview/thalamus/explorer/nano-caller": resolve(
    root,
    "packages/thalamus/src/explorer/nano-caller.ts",
  ),
  "@interview/thalamus/services/research-graph.service": resolve(
    root,
    "packages/thalamus/src/services/research-graph.service.ts",
  ),
  "@interview/db-schema": resolve(root, "packages/db-schema/src/index.ts"),
  "@interview/thalamus": resolve(root, "packages/thalamus/src/index.ts"),
  "@interview/sweep": resolve(root, "packages/sweep/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
  },
});
