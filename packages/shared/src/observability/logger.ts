import pino from "pino";
import type { Logger } from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";
const isTest = process.env.NODE_ENV === "test";

export function createLogger(serviceName: string): Logger {
  const baseOptions = {
    env: process.env.NODE_ENV || "development",
    service: serviceName,
  };

  const redactConfig = {
    paths: ["req.headers.authorization", "req.headers.cookie"],
    remove: true,
  };

  if (isTest) {
    return pino({ level: "silent" });
  }

  if (isDevelopment) {
    return pino({
      level: process.env.LOG_LEVEL || "debug",
      base: baseOptions,
      redact: redactConfig,
      transport: {
        targets: [
          {
            target: "pino-pretty",
            level: "debug",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
          {
            target: "pino/file",
            level: "info",
            options: {
              destination: "./logs/server.log",
              mkdir: true,
            },
          },
        ],
        // Node 24 --watch inflates process.execArgv with internal flags
        // that Worker threads reject. Empty execArgv prevents leakage.
        worker: { execArgv: [] },
      },
    });
  }

  // Production — only enable pino-loki when LOKI_HOST is explicitly set
  const lokiHost = process.env.LOKI_HOST;
  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino/file",
      level: "info",
      options: { destination: 1 }, // stdout — captured by fly logs / k8s
    },
  ];

  if (lokiHost) {
    targets.push({
      target: "pino-loki",
      level: "info",
      options: {
        batching: true,
        interval: 5,
        host: lokiHost,
        labels: {
          app: serviceName,
          env: process.env.NODE_ENV || "production",
        },
        timeout: 10000,
        silenceErrors: true,
      },
    });
  }

  return pino({
    level: process.env.LOG_LEVEL || "info",
    base: baseOptions,
    redact: redactConfig,
    transport: { targets, worker: { execArgv: [] } },
  });
}

export type { Logger };
