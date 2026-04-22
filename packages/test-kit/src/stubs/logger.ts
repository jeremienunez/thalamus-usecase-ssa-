import type { Bindings, ChildLoggerOptions } from "pino";
import { typedSpy } from "../typed-spy";

export interface StubLogger {
  level: string;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  silent: (...args: unknown[]) => void;
  child: (bindings?: Bindings, options?: ChildLoggerOptions) => StubLogger;
}

export function stubLogger(): StubLogger & {
  info: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  warn: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  error: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  debug: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  trace: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  fatal: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  silent: ReturnType<typeof typedSpy<(...args: unknown[]) => void>>;
  child: ReturnType<
    typeof typedSpy<
      (bindings?: Bindings, options?: ChildLoggerOptions) => StubLogger
    >
  >;
} {
  const logger = {
    level: "info",
    info: typedSpy<(...args: unknown[]) => void>(),
    warn: typedSpy<(...args: unknown[]) => void>(),
    error: typedSpy<(...args: unknown[]) => void>(),
    debug: typedSpy<(...args: unknown[]) => void>(),
    trace: typedSpy<(...args: unknown[]) => void>(),
    fatal: typedSpy<(...args: unknown[]) => void>(),
    silent: typedSpy<(...args: unknown[]) => void>(),
    child: typedSpy<
      (bindings?: Bindings, options?: ChildLoggerOptions) => StubLogger
    >(),
  };
  logger.child.mockImplementation(() => logger);
  return logger;
}
