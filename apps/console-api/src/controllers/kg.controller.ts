import type { KgViewService } from "../services/kg-view.service";
import { asyncHandler } from "../utils/async-handler";

export function kgNodesController(service: KgViewService) {
  return asyncHandler(() => service.listNodes());
}

export function kgEdgesController(service: KgViewService) {
  return asyncHandler(() => service.listEdges());
}
