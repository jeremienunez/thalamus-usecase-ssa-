import type IORedis from "ioredis";

export interface SwarmAggregateGate {
  reset(swarmId: number): Promise<void>;
  claim(swarmId: number): Promise<boolean>;
  release(swarmId: number): Promise<void>;
}

const DEFAULT_PREFIX = "sim:swarm:aggregate-enqueued";
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

function keyFor(prefix: string, swarmId: number): string {
  return `${prefix}:${swarmId}`;
}

export class RedisSwarmAggregateGate implements SwarmAggregateGate {
  constructor(
    private readonly redis: IORedis,
    private readonly opts: {
      prefix?: string;
      ttlSec?: number;
    } = {},
  ) {}

  async reset(swarmId: number): Promise<void> {
    await this.redis.del(keyFor(this.prefix, swarmId));
  }

  async claim(swarmId: number): Promise<boolean> {
    const result = await this.redis.set(
      keyFor(this.prefix, swarmId),
      "1",
      "EX",
      this.ttlSec,
      "NX",
    );
    return result === "OK";
  }

  async release(swarmId: number): Promise<void> {
    await this.redis.del(keyFor(this.prefix, swarmId));
  }

  private get prefix(): string {
    return this.opts.prefix ?? DEFAULT_PREFIX;
  }

  private get ttlSec(): number {
    return this.opts.ttlSec ?? DEFAULT_TTL_SEC;
  }
}
