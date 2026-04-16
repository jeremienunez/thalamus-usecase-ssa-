import { defineWorkspace } from "vitest/config";
import { resolve } from "node:path";

/**
 * Match the TS path aliases declared in tsconfig.base.json so vitest resolves
 * sub-path imports like `@interview/shared/observability` the same way tsc does.
 */
const aliases = {
  "@interview/shared/observability": resolve(
    __dirname,
    "packages/shared/src/observability/index.ts",
  ),
  "@interview/shared/enum": resolve(
    __dirname,
    "packages/shared/src/enum/index.ts",
  ),
  "@interview/shared/utils": resolve(
    __dirname,
    "packages/shared/src/utils/index.ts",
  ),
  "@interview/shared/types": resolve(__dirname, "packages/shared/src/types"),
  "@interview/shared/schemas": resolve(
    __dirname,
    "packages/shared/src/schemas",
  ),
  "@interview/shared": resolve(__dirname, "packages/shared/src/index.ts"),
  // Thalamus subpath imports used at runtime by sweep services.
  "@interview/thalamus/explorer/nano-caller": resolve(
    __dirname,
    "packages/thalamus/src/explorer/nano-caller.ts",
  ),
  "@interview/thalamus/services/research-graph.service": resolve(
    __dirname,
    "packages/thalamus/src/services/research-graph.service.ts",
  ),
  "@interview/db-schema": resolve(__dirname, "packages/db-schema/src/index.ts"),
  "@interview/thalamus": resolve(__dirname, "packages/thalamus/src/index.ts"),
  "@interview/sweep": resolve(__dirname, "packages/sweep/src/index.ts"),
};

const base = {
  globals: true,
  environment: "node" as const,
  alias: aliases,
};

export default defineWorkspace([
  {
    resolve: { alias: aliases },
    test: {
      ...base,
      name: "unit",
      include: ["packages/*/tests/**/*.spec.ts"],
      exclude: ["packages/*/tests/integration/**", "packages/*/tests/e2e/**"],
    },
  },
  {
    resolve: { alias: aliases },
    test: {
      ...base,
      name: "integration",
      include: ["packages/*/tests/integration/**/*.spec.ts"],
      testTimeout: 15000,
    },
  },
  "./apps/console-api/vitest.config.ts",
  {
    resolve: { alias: aliases },
    test: {
      ...base,
      name: "e2e",
      include: ["packages/*/tests/e2e/**/*.spec.ts"],
      testTimeout: 30000,
    },
  },
]);
