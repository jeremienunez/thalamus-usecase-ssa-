/**
 * SSA ingestion provider — aggregates the 6 SSA fetchers behind the
 * IngestionSourceProvider port. The engine-side IngestionRegistry
 * (Task 2.4 adds the providers[] hook) consumes this via the console-api
 * container (Task 3.1).
 */

import type { IngestionSourceProvider } from "@interview/sweep";
import { tleHistorySource } from "./tle-history-fetcher";
import { spaceWeatherSource } from "./space-weather-fetcher";
import { launchManifestSource } from "./launch-manifest-fetcher";
import { notamSource } from "./notam-fetcher";
import { fragmentationEventsSource } from "./fragmentation-events-fetcher";
import { ituFilingsSource } from "./itu-filings-fetcher";

export {
  tleHistorySource,
  spaceWeatherSource,
  launchManifestSource,
  notamSource,
  fragmentationEventsSource,
  ituFilingsSource,
};

export const ssaIngestionProvider: IngestionSourceProvider = {
  register(ctx) {
    ctx.add(tleHistorySource);
    ctx.add(spaceWeatherSource);
    ctx.add(launchManifestSource);
    ctx.add(notamSource);
    ctx.add(fragmentationEventsSource);
    ctx.add(ituFilingsSource);
  },
};
