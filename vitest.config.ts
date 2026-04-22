import { defineConfig, defineProject } from "vitest/config";
import { resolve } from "node:path";

/**
 * Match the TS path aliases declared in tsconfig.base.json so Vitest resolves
 * sub-path imports like `@interview/shared/observability` the same way tsc does.
 */
const aliases = {
  "@interview/shared/observability/": resolve(
    __dirname,
    "packages/shared/src/observability/",
  ),
  "@interview/shared/observability": resolve(
    __dirname,
    "packages/shared/src/observability/index.ts",
  ),
  "@interview/shared/enum/": resolve(__dirname, "packages/shared/src/enum/"),
  "@interview/shared/enum": resolve(
    __dirname,
    "packages/shared/src/enum/index.ts",
  ),
  "@interview/shared/utils/": resolve(__dirname, "packages/shared/src/utils/"),
  "@interview/shared/utils": resolve(
    __dirname,
    "packages/shared/src/utils/index.ts",
  ),
  "@interview/shared/types": resolve(__dirname, "packages/shared/src/types"),
  "@interview/shared/schemas": resolve(
    __dirname,
    "packages/shared/src/schemas",
  ),
  "@interview/shared/config": resolve(
    __dirname,
    "packages/shared/src/config/index.ts",
  ),
  "@interview/shared": resolve(__dirname, "packages/shared/src/index.ts"),
  // Thalamus subpath imports used at runtime by sweep services.
  "@interview/thalamus/explorer/curator": resolve(
    __dirname,
    "packages/thalamus/src/explorer/curator.ts",
  ),
  "@interview/thalamus/explorer/nano-caller": resolve(
    __dirname,
    "packages/thalamus/src/explorer/nano-caller.ts",
  ),
  "@interview/thalamus/explorer/nano-swarm": resolve(
    __dirname,
    "packages/thalamus/src/explorer/nano-swarm.ts",
  ),
  "@interview/thalamus/services/research-graph.service": resolve(
    __dirname,
    "packages/thalamus/src/services/research-graph.service.ts",
  ),
  "@interview/db-schema": resolve(__dirname, "packages/db-schema/src/index.ts"),
  "@interview/test-kit": resolve(__dirname, "packages/test-kit/src/index.ts"),
  "@interview/thalamus": resolve(__dirname, "packages/thalamus/src/index.ts"),
  "@interview/sweep": resolve(__dirname, "packages/sweep/src/index.ts"),
};

const nodeProjectDefaults = {
  globals: true,
  environment: "node" as const,
};

export default defineConfig({
  test: {
    projects: [
      defineProject({
        resolve: { alias: aliases },
        test: {
          ...nodeProjectDefaults,
          name: "unit",
          sequence: { groupOrder: 0 },
          include: [
            "packages/*/tests/**/*.spec.ts",
            "packages/*/src/**/*.test.ts",
            "apps/console-api/tests/unit/**/*.test.ts",
          ],
          exclude: [
            "packages/*/tests/integration/**",
            "packages/*/tests/e2e/**",
            "apps/console-api/tests/integration/**",
            "apps/console-api/tests/e2e/**",
          ],
        },
      }),
      defineProject({
        resolve: { alias: aliases },
        test: {
          ...nodeProjectDefaults,
          name: "integration",
          sequence: { groupOrder: 1 },
          include: [
            "packages/*/tests/integration/**/*.spec.ts",
            "apps/console-api/tests/integration/**/*.spec.ts",
          ],
          testTimeout: 15000,
          hookTimeout: 120000,
          teardownTimeout: 120000,
        },
      }),
      defineProject({
        resolve: { alias: aliases },
        test: {
          ...nodeProjectDefaults,
          name: "e2e",
          sequence: { groupOrder: 2 },
          include: [
            "packages/*/tests/e2e/**/*.spec.ts",
            "apps/console-api/tests/e2e/**/*.spec.ts",
          ],
          globalSetup: ["./apps/console-api/tests/e2e/setup.ts"],
          testTimeout: 30000,
          hookTimeout: 30000,
          teardownTimeout: 30000,
          // E2E relies on a single live Fastify + Redis/Postgres stack.
          pool: "forks",
          maxWorkers: 1,
          isolate: false,
        },
      }),
      "apps/console/vitest.config.ts",
    ],
  },
});
