/**
 * Shared DTO schemas — reusable across all DTOs.
 * M33 fix: pagination was duplicated 7 times.
 */

import { z } from "zod";

/** Standard page/limit query params */
export const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
};
