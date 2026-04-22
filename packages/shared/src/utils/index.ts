/**
 * Shared utility functions — trimmed for standalone extraction.
 */

export * from "./async-handler";
export * from "./error";
export * from "./json";
export * from "./string";
export * from "./markup";
export * from "./collection";
export * from "./completeness-scorer";
export * from "./concurrency";
export * from "./domain-normalizer";
export * from "./llm-json-parser";

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}
