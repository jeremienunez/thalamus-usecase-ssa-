import {
  type ConfigProvider,
  type SimSwarmConfig,
  DEFAULT_SIM_SWARM_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

let provider: ConfigProvider<SimSwarmConfig> =
  new StaticConfigProvider(DEFAULT_SIM_SWARM_CONFIG);

export function setSimSwarmConfigProvider(
  p: ConfigProvider<SimSwarmConfig>,
): void {
  provider = p;
}

export function getSimSwarmConfig(): Promise<SimSwarmConfig> {
  return provider.get();
}
