import {
  type ConfigProvider,
  type SimEmbeddingConfig,
  DEFAULT_SIM_EMBEDDING_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

let provider: ConfigProvider<SimEmbeddingConfig> =
  new StaticConfigProvider(DEFAULT_SIM_EMBEDDING_CONFIG);

export function setSimEmbeddingConfigProvider(
  p: ConfigProvider<SimEmbeddingConfig>,
): void {
  provider = p;
}

export function getSimEmbeddingConfig(): Promise<SimEmbeddingConfig> {
  return provider.get();
}
