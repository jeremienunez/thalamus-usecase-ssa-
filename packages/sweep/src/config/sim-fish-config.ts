/**
 * Sim fish (agent-turn) LLM config provider.
 *
 * Mirror of the thalamus nano/planner/cortex provider pattern. Consumers
 * (turn-runner-sequential, turn-runner-dag) call `getSimFishConfig()`
 * before each nano dispatch and pass the resulting values as
 * `NanoRequest.overrides` to override the fallback nano defaults.
 */

import {
  type ConfigProvider,
  type SimFishConfig,
  DEFAULT_SIM_FISH_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

let provider: ConfigProvider<SimFishConfig> =
  new StaticConfigProvider(DEFAULT_SIM_FISH_CONFIG);

export function setSimFishConfigProvider(
  p: ConfigProvider<SimFishConfig>,
): void {
  provider = p;
}

export function getSimFishConfig(): Promise<SimFishConfig> {
  return provider.get();
}
