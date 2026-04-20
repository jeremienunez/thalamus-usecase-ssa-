const KNOWN_VERBS = /^\s*\/?(query|telemetry|logs|graph|accept|explain|pc|why|corroborate|tlm|tail|neighbou?rhood)\b/i;

function looksLikeCommand(input: string): boolean {
  return input.trim().startsWith("/") || KNOWN_VERBS.test(input);
}

export function isSlashCommand(input: string): boolean {
  return looksLikeCommand(input);
}
