/**
 * WebSearchPort — abstraction over external web-search providers.
 *
 * Keeps the kernel free of HTTP, env access, and provider-specific wire
 * formats. Adapters live in `../transports/` and are wired by the
 * composition root.
 */

export interface WebSearchPort {
  /**
   * Execute a web search.
   *
   * @param instruction - natural-language prompt passed to the provider
   * @param query - original search query (for logging / provider metadata)
   * @returns raw text content, or `""` if the search produced nothing
   */
  search(instruction: string, query: string): Promise<string>;
}
