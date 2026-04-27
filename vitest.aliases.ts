import { resolve } from "node:path";

export type WorkspaceAliasMap = Record<string, string>;

export function workspaceAliases(root: string): WorkspaceAliasMap {
  return {
    "@interview/shared/observability/": resolve(
      root,
      "packages/shared/src/observability/",
    ),
    "@interview/shared/observability": resolve(
      root,
      "packages/shared/src/observability/index.ts",
    ),
    "@interview/shared/enum/": resolve(root, "packages/shared/src/enum/"),
    "@interview/shared/enum": resolve(
      root,
      "packages/shared/src/enum/index.ts",
    ),
    "@interview/shared/utils/": resolve(root, "packages/shared/src/utils/"),
    "@interview/shared/utils": resolve(
      root,
      "packages/shared/src/utils/index.ts",
    ),
    "@interview/shared/types": resolve(root, "packages/shared/src/types"),
    "@interview/shared/schemas": resolve(root, "packages/shared/src/schemas"),
    "@interview/shared/config": resolve(
      root,
      "packages/shared/src/config/index.ts",
    ),
    "@interview/shared": resolve(root, "packages/shared/src/index.ts"),
    "@interview/thalamus/explorer/curator": resolve(
      root,
      "packages/thalamus/src/explorer/curator.ts",
    ),
    "@interview/thalamus/explorer/nano-caller": resolve(
      root,
      "packages/thalamus/src/explorer/nano-caller.ts",
    ),
    "@interview/thalamus/explorer/nano-swarm": resolve(
      root,
      "packages/thalamus/src/explorer/nano-swarm.ts",
    ),
    "@interview/thalamus/services/research-graph.service": resolve(
      root,
      "packages/thalamus/src/services/research-graph.service.ts",
    ),
    "@interview/db-schema": resolve(root, "packages/db-schema/src/index.ts"),
    "@interview/temporal": resolve(root, "packages/temporal/src/index.ts"),
    "@interview/test-kit": resolve(root, "packages/test-kit/src/index.ts"),
    "@interview/thalamus": resolve(root, "packages/thalamus/src/index.ts"),
    "@interview/sweep/internal": resolve(root, "packages/sweep/src/internal.ts"),
    "@interview/sweep": resolve(root, "packages/sweep/src/index.ts"),
  };
}
