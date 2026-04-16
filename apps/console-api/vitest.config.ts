import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const aliases = {
  "@interview/shared/observability": resolve(root, "packages/shared/src/observability/index.ts"),
  "@interview/shared/enum": resolve(root, "packages/shared/src/enum/index.ts"),
  "@interview/shared/utils": resolve(root, "packages/shared/src/utils/index.ts"),
  "@interview/shared/types": resolve(root, "packages/shared/src/types"),
  "@interview/shared/schemas": resolve(root, "packages/shared/src/schemas"),
  "@interview/shared": resolve(root, "packages/shared/src/index.ts"),
  "@interview/thalamus/explorer/nano-caller": resolve(root, "packages/thalamus/src/explorer/nano-caller.ts"),
  "@interview/thalamus/services/research-graph.service": resolve(root, "packages/thalamus/src/services/research-graph.service.ts"),
  "@interview/db-schema": resolve(root, "packages/db-schema/src/index.ts"),
  "@interview/thalamus": resolve(root, "packages/thalamus/src/index.ts"),
  "@interview/sweep": resolve(root, "packages/sweep/src/index.ts"),
};

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    name: "console-api",
    globals: true,
    environment: "node",
    alias: aliases,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.spec.ts",
      "tests/e2e/**/*.spec.ts",
    ],
    globalSetup: ["./tests/e2e/setup.ts"],
    testTimeout: 30000,
    // Must run in a single fork so `CONSOLE_API_URL` set by globalSetup reaches
    // every spec, and so the seeded Redis state isn't raced by parallel tests.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
