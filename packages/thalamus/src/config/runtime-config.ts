/**
 * Runtime-config providers for thalamus kernel (planner / cortex / reflexion).
 *
 * Mirror of the nano-caller / nano-swarm provider pattern. Consumers read
 * config via `getPlannerConfig()` / `getCortexConfig()` /
 * `getReflexionConfig()`; tests inject static providers; console-api
 * container wires Redis-backed providers at boot.
 */

import {
  type ConfigProvider,
  type ThalamusPlannerConfig,
  type ThalamusCortexConfig,
  type ThalamusReflexionConfig,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

let plannerProvider: ConfigProvider<ThalamusPlannerConfig> =
  new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG);

let cortexProvider: ConfigProvider<ThalamusCortexConfig> =
  new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG);

let reflexionProvider: ConfigProvider<ThalamusReflexionConfig> =
  new StaticConfigProvider(DEFAULT_THALAMUS_REFLEXION_CONFIG);

export function setPlannerConfigProvider(
  provider: ConfigProvider<ThalamusPlannerConfig>,
): void {
  plannerProvider = provider;
}

export function setCortexConfigProvider(
  provider: ConfigProvider<ThalamusCortexConfig>,
): void {
  cortexProvider = provider;
}

export function setReflexionConfigProvider(
  provider: ConfigProvider<ThalamusReflexionConfig>,
): void {
  reflexionProvider = provider;
}

export function getPlannerConfig(): Promise<ThalamusPlannerConfig> {
  return plannerProvider.get();
}

export function getCortexConfig(): Promise<ThalamusCortexConfig> {
  return cortexProvider.get();
}

export function getReflexionConfig(): Promise<ThalamusReflexionConfig> {
  return reflexionProvider.get();
}
