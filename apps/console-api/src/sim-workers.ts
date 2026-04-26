import IORedis from "ioredis";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THALAMUS_TRANSPORT_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import {
  CortexRegistry,
  registerThalamusConfigDomains,
  setNanoConfigProvider,
  setThalamusTransportConfigProvider,
} from "@interview/thalamus";
import {
  buildSweepContainer,
  registerSweepConfigDomains,
  setSimEmbeddingConfigProvider,
  setSimFishConfigProvider,
  setSimSwarmConfigProvider,
  SimHttpClient,
  SimPromotionHttpClient,
  SimQueueHttpAdapter,
  SimRuntimeStoreHttpAdapter,
  SimScenarioContextHttpAdapter,
  SimSubjectHttpAdapter,
  SimSwarmStoreHttpAdapter,
  type DomainAuditProvider,
  type ResolutionHandlerRegistry,
  type SweepPromotionAdapter,
} from "@interview/sweep";
import {
  createSwarmAggregateWorker,
  createSwarmFishWorker,
} from "@interview/sweep/internal";
import {
  SsaActionSchemaProvider,
  SsaAggregationStrategy,
  SsaCortexSelector,
  SsaPersonaComposer,
  SsaPerturbationPack,
  SsaPromptRenderer,
} from "./agent/ssa/sim";
import { PcAggregatorService } from "./agent/ssa/sim/aggregators/pc";
import { TelemetryAggregatorService } from "./agent/ssa/sim/aggregators/telemetry";
import { SsaKindGuard } from "./agent/ssa/sim/kind-guard";
import { RuntimeConfigRepository } from "./repositories/runtime-config.repository";
import { RuntimeConfigService } from "./services/runtime-config.service";
import { SsaSimOutcomeResolverService } from "./services/ssa-sim-outcome-resolver.service";

const BASE_URL = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const MODE = readMode(process.env.THALAMUS_MODE) ?? "cloud";
const DEFAULT_SIM_KERNEL_SHARED_SECRET = "interview-local-kernel-secret";
const KERNEL_SECRET =
  process.env.SIM_KERNEL_SHARED_SECRET ?? DEFAULT_SIM_KERNEL_SHARED_SECRET;
const SKILLS_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "./agent/ssa/skills",
);

const disabledAuditProvider: DomainAuditProvider = {
  async runAudit(): Promise<never> {
    throw new Error("sim worker process does not run nano-sweep audit");
  },
};

const disabledPromotionAdapter: SweepPromotionAdapter = {
  async promote(): Promise<never> {
    throw new Error("sim worker process does not run sweep promotion");
  },
};

const disabledResolutionHandlers: ResolutionHandlerRegistry = {
  get: () => undefined,
  list: () => [],
};

async function main(): Promise<void> {
  if (
    MODE === "cloud" &&
    !process.env.OPENAI_API_KEY &&
    !process.env.DEEPSEEK_API_KEY
  ) {
    throw new Error(
      "OPENAI_API_KEY or DEEPSEEK_API_KEY is required for THALAMUS_MODE=cloud",
    );
  }

  setThalamusTransportConfigProvider(
    new StaticConfigProvider({
      ...DEFAULT_THALAMUS_TRANSPORT_CONFIG,
      mode: MODE,
      fixturesDir: process.env.FIXTURES_DIR ?? "",
      fallbackFixture: process.env.FIXTURES_FALLBACK ?? "",
      openaiApiKey: process.env.OPENAI_API_KEY ?? "",
      deepseekApiUrl:
        process.env.DEEPSEEK_API_URL ??
        DEFAULT_THALAMUS_TRANSPORT_CONFIG.deepseekApiUrl,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
      deepseekModel:
        process.env.DEEPSEEK_MODEL ??
        DEFAULT_THALAMUS_TRANSPORT_CONFIG.deepseekModel,
      deepseekMaxTokens: readPositiveInt(
        process.env.DEEPSEEK_MAX_TOKENS,
        DEFAULT_THALAMUS_TRANSPORT_CONFIG.deepseekMaxTokens,
      ),
    }),
  );

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const runtimeConfigService = new RuntimeConfigService(
    new RuntimeConfigRepository(redis),
  );
  registerThalamusConfigDomains(runtimeConfigService);
  registerSweepConfigDomains(runtimeConfigService);
  setNanoConfigProvider(runtimeConfigService.provider("thalamus.nano"));
  setSimFishConfigProvider(runtimeConfigService.provider("sim.fish"));
  setSimSwarmConfigProvider(runtimeConfigService.provider("sim.swarm"));
  setSimEmbeddingConfigProvider(runtimeConfigService.provider("sim.embedding"));

  const registry = new CortexRegistry(SKILLS_DIR);
  registry.discover();
  if (!registry.get("sim_operator_agent")) {
    throw new Error(`sim_operator_agent skill not found in ${SKILLS_DIR}`);
  }

  const simHttp = new SimHttpClient(createFetchSimTransport(BASE_URL));
  const queue = new SimQueueHttpAdapter(simHttp, { kernelSecret: KERNEL_SECRET });
  const runtimeStore = new SimRuntimeStoreHttpAdapter(simHttp);
  const swarmStore = new SimSwarmStoreHttpAdapter(simHttp);
  const subjects = new SimSubjectHttpAdapter(simHttp);
  const scenarioContext = new SimScenarioContextHttpAdapter(simHttp);
  const promotion = new SimPromotionHttpClient(simHttp, {
    kernelSecret: KERNEL_SECRET,
  });

  const ssaKindGuard = new SsaKindGuard();
  const container = buildSweepContainer({
    redis,
    ports: {
      audit: disabledAuditProvider,
      promotion: disabledPromotionAdapter,
      resolutionHandlers: disabledResolutionHandlers,
    },
    sim: {
      cortexRegistry: registry,
      embed: async () => null,
      llmMode: MODE,
      queue,
      runtimeStore,
      swarmStore,
      subjects,
      scenarioContext,
      persona: new SsaPersonaComposer(),
      prompt: new SsaPromptRenderer(),
      cortexSelector: new SsaCortexSelector(),
      schemaProvider: new SsaActionSchemaProvider(),
      perturbationPack: new SsaPerturbationPack(),
      aggStrategy: new SsaAggregationStrategy(),
      kindGuard: ssaKindGuard,
    },
  });

  if (!container.sim) {
    throw new Error("sim services failed to initialize");
  }

  const fishWorker = createSwarmFishWorker({
    store: runtimeStore,
    swarmService: container.sim.swarmService,
    sequentialRunner: container.sim.sequentialRunner,
    dagRunner: container.sim.dagRunner,
    kindGuard: ssaKindGuard,
    concurrency: readPositiveInt(process.env.SIM_FISH_WORKER_CONCURRENCY, 8),
  });

  const outcomeResolver = new SsaSimOutcomeResolverService({
    aggregator: container.sim.aggregator,
    telemetryAggregator: new TelemetryAggregatorService({ swarmStore }),
    pcAggregator: new PcAggregatorService({ swarmStore }),
    promotionService: {
      emitSuggestionFromModal: async (swarmId, aggregate) => {
        await promotion.emitSuggestionFromModal({ swarmId, aggregate });
        return null;
      },
      emitTelemetrySuggestions: async (aggregate) => {
        await promotion.emitScalarSuggestions({
          swarmId: aggregate.swarmId,
          aggregate,
        });
        return [];
      },
    },
  });

  const aggregateWorker = createSwarmAggregateWorker({
    swarmStore,
    resolver: outcomeResolver,
    concurrency: readPositiveInt(process.env.SIM_AGGREGATE_WORKER_CONCURRENCY, 1),
  });

  await Promise.all([
    fishWorker.waitUntilReady(),
    aggregateWorker.waitUntilReady(),
  ]);

  console.log(
    `sim workers ready · api=${BASE_URL} · redis=${REDIS_URL} · mode=${MODE}`,
  );

  await new Promise<void>((resolveStop) => {
    const stop = async () => {
      await Promise.all([
        fishWorker.close(),
        aggregateWorker.close(),
        redis.quit(),
      ]);
      resolveStop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function createFetchSimTransport(baseUrl: string) {
  return {
    async request(input: {
      method: "GET" | "POST" | "PATCH";
      path: string;
      query?: Record<string, string | number | boolean | null | undefined>;
      json?: unknown;
      headers?: Record<string, string>;
    }) {
      const url = new URL(input.path, baseUrl);
      for (const [key, value] of Object.entries(input.query ?? {})) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
      const res = await fetch(url, {
        method: input.method,
        headers:
          input.json === undefined
            ? input.headers
            : { "content-type": "application/json", ...(input.headers ?? {}) },
        body: input.json === undefined ? undefined : JSON.stringify(input.json),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text.length > 0 ? JSON.parse(text) : {},
      };
    },
  };
}

function readMode(value: string | undefined): "cloud" | "fixtures" | "record" | null {
  return value === "cloud" || value === "fixtures" || value === "record"
    ? value
    : null;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
