import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

export interface MetricsConfig {
  serviceName: string;
  enableDefaultMetrics?: boolean;
}

export class MetricsCollector {
  public readonly registry: Registry;
  private readonly serviceName: string;

  constructor(config: MetricsConfig) {
    this.serviceName = config.serviceName;
    this.registry = new Registry();

    this.registry.setDefaultLabels({
      app: config.serviceName,
      env: process.env.NODE_ENV || 'development',
    });

    if (config.enableDefaultMetrics !== false) {
      collectDefaultMetrics({
        register: this.registry,
        prefix: 'app_',
      });
    }
  }

  createCounter(name: string, help: string, labelNames: string[] = []) {
    return new Counter({
      name,
      help,
      labelNames,
      registers: [this.registry],
    });
  }

  createHistogram(
    name: string,
    help: string,
    buckets: number[] = [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    labelNames: string[] = []
  ) {
    return new Histogram({
      name,
      help,
      buckets,
      labelNames,
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
