import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConfigProvider,
  type ThalamusTransportConfig,
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

let transportConfigProvider: ConfigProvider<ThalamusTransportConfig> =
  new StaticConfigProvider(DEFAULT_THALAMUS_TRANSPORT_CONFIG);

let transportConfigSnapshot: ThalamusTransportConfig =
  DEFAULT_THALAMUS_TRANSPORT_CONFIG;

export function setThalamusTransportConfigProvider(
  provider: ConfigProvider<ThalamusTransportConfig>,
): void {
  transportConfigProvider = provider;
}

export async function getThalamusTransportConfig(): Promise<ThalamusTransportConfig> {
  transportConfigSnapshot = await transportConfigProvider.get();
  return transportConfigSnapshot;
}

export function getThalamusTransportConfigSnapshot(): ThalamusTransportConfig {
  return transportConfigSnapshot;
}

export function defaultFixturesDir(): string {
  return join(__dirname, "..", "..", "..", "..", "fixtures", "recorded");
}

export function resolveFixturesDir(
  fixturesDir: string | null | undefined,
): string {
  return fixturesDir && fixturesDir.trim() !== ""
    ? fixturesDir
    : defaultFixturesDir();
}
