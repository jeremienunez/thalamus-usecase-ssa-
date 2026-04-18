/**
 * SSA ingestion provider — aggregates the 6 SSA fetchers behind the
 * IngestionSourceProvider port. Each fetcher is a factory that closes over
 * the console-api Drizzle handle; the engine-side IngestionRegistry sees
 * only opaque `IngestionSource` objects.
 */

import type { Database } from "@interview/db-schema";
import type { IngestionSourceProvider } from "@interview/sweep";
import { createTleHistorySource } from "./tle-history-fetcher";
import { createSpaceWeatherSource } from "./space-weather-fetcher";
import { createLaunchManifestSource } from "./launch-manifest-fetcher";
import { createNotamSource } from "./notam-fetcher";
import { createFragmentationEventsSource } from "./fragmentation-events-fetcher";
import { createItuFilingsSource } from "./itu-filings-fetcher";

export {
  createTleHistorySource,
  createSpaceWeatherSource,
  createLaunchManifestSource,
  createNotamSource,
  createFragmentationEventsSource,
  createItuFilingsSource,
};

export function createSsaIngestionProvider(
  db: Database,
): IngestionSourceProvider {
  return {
    register(ctx) {
      ctx.add(createTleHistorySource(db));
      ctx.add(createSpaceWeatherSource(db));
      ctx.add(createLaunchManifestSource(db));
      ctx.add(createNotamSource(db));
      ctx.add(createFragmentationEventsSource(db));
      ctx.add(createItuFilingsSource(db));
    },
  };
}
