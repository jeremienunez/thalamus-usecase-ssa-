import { z } from "zod";

export const numericIdString = (message = "id must be numeric") =>
  z.string().regex(/^\d+$/, message);

export const optionalNonEmptyString = () =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  );

export const optionalFiniteNumber = () =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : Number(value)),
    z.number().finite().optional(),
  );
