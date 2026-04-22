import { z } from "zod";

export function parseFixture<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `parseFixture: fixture does not match schema:\n${JSON.stringify(result.error.format(), null, 2)}`,
    );
  }
  return result.data;
}
