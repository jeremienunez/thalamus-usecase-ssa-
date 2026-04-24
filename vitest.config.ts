import { defineConfig, defineProject } from "vitest/config";
import { workspaceAliases } from "./vitest.aliases";

const aliases = workspaceAliases(__dirname);

const nodeProjectDefaults = {
  globals: true,
  environment: "node" as const,
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      all: true,
      clean: true,
      reportOnFailure: true,
      reportsDirectory: "./coverage",
      reporter: ["text", "json-summary", "html"],
      include: [
        "apps/**/src/**/*.{ts,tsx}",
        "packages/**/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.d.ts",
        "**/src/**/*.test.{ts,tsx}",
        "**/src/**/__tests__/**",
        "**/src/**/__fixtures__/**",
        "**/src/**/fixtures/**",
        "**/src/fixtures.{ts,tsx}",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
        perFile: true,
      },
    },
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
