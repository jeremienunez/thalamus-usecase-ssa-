import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

export function countTokens(s: string): number {
  if (!s) return 0;
  return enc.encode(s).length;
}
