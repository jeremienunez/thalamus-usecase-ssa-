/**
 * ConfigProvider<T> — kernel-side read of a runtime-tunable config domain.
 *
 * Packages consume a provider instance; ops updates via HTTP flow through
 * the console-api service into a Redis-backed impl, while CLI / E2E /
 * unit tests inject `new StaticConfigProvider(DEFAULT_*)`.
 */

export interface ConfigProvider<T> {
  get(): Promise<T>;
}

export class StaticConfigProvider<T> implements ConfigProvider<T> {
  constructor(private readonly value: T) {}
  async get(): Promise<T> {
    return this.value;
  }
}
