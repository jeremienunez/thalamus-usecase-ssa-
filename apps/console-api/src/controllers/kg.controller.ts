import type { KgViewService } from "../services/kg-view.service";
import { asyncHandler } from "../utils/async-handler";

export type KgControllerPort = Pick<KgViewService, "listNodes" | "listEdges">;

export function kgNodesController(service: KgControllerPort) {
  return asyncHandler(() => service.listNodes());
}

export function kgEdgesController(service: KgControllerPort) {
  return asyncHandler(() => service.listEdges());
}
