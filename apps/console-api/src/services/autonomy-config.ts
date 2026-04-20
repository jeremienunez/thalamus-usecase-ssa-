import {
  type ConfigProvider,
  type ConsoleAutonomyConfig,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

let autonomyProvider: ConfigProvider<ConsoleAutonomyConfig> =
  new StaticConfigProvider(DEFAULT_CONSOLE_AUTONOMY_CONFIG);

export function setAutonomyConfigProvider(
  provider: ConfigProvider<ConsoleAutonomyConfig>,
): void {
  autonomyProvider = provider;
}

export function getAutonomyConfig(): Promise<ConsoleAutonomyConfig> {
  return autonomyProvider.get();
}
