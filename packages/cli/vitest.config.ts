import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { workspaceAliases } from "../../vitest.aliases";

const root = resolve(__dirname, "..", "..");
const alias = workspaceAliases(root);

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
  },
});
