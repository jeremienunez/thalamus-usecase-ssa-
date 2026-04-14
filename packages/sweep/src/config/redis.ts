import Redis from "ioredis";

// Lazy-initialized Redis client. In tests, use ioredis-mock and inject.
// BullMQ requires `maxRetriesPerRequest: null` on blocking-command connections,
// so the default client is created with that option set — callers that inject
// their own client via setRedisClient() must do the same.
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
      maxRetriesPerRequest: null,
    });
  }
  return _redis;
}

// Lazy proxy so imports resolve before connection is needed
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    const client = getRedis();
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function setRedisClient(client: Redis): void {
  _redis = client;
}
