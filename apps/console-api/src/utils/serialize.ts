export function toIsoOrNull(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toIsoStrict(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function idOrNull(
  value: string | number | bigint | null | undefined,
): string | null {
  return value == null ? null : String(value);
}
