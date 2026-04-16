import { asyncHandler } from "../utils/async-handler";

export const healthController = asyncHandler(async () => ({
  ok: true,
  ts: new Date().toISOString(),
}));
