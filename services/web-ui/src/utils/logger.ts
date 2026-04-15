/**
 * Structured logger for the web-ui.
 *
 * Components must not call `console.*` directly — use `createLogger(namespace)`
 * so log output is uniform, namespaced, and silenceable in tests. The sink is
 * injectable for tests via `__setLoggerSinkForTests`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  namespace: string;
  message: string;
  context: Record<string, unknown> | undefined;
  timestamp: string;
}

export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

type Sink = (entry: LogEntry) => void;

const isTestEnv = (): boolean => {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return proc?.env?.NODE_ENV === "test";
  } catch {
    return false;
  }
};

const consoleSink: Sink = (entry) => {
  const prefix = `[${entry.namespace}]`;
  const args: unknown[] = entry.context ? [prefix, entry.message, entry.context] : [prefix, entry.message];
  switch (entry.level) {
    case "debug": console.debug(...args); break;
    case "info":  console.info(...args);  break;
    case "warn":  console.warn(...args);  break;
    case "error": console.error(...args); break;
  }
};

const silentSink: Sink = () => { /* no-op */ };

let activeSink: Sink = isTestEnv() ? silentSink : consoleSink;

export function __setLoggerSinkForTests(sink: Sink): void {
  activeSink = sink;
}

export function __resetLoggerSinkForTests(): void {
  activeSink = isTestEnv() ? silentSink : consoleSink;
}

export function createLogger(namespace: string): Logger {
  if (!namespace || namespace.trim().length === 0) {
    throw new Error("createLogger: namespace must be a non-empty string");
  }
  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    activeSink({
      level,
      namespace,
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  };
  return {
    debug: (message, context) => emit("debug", message, context),
    info:  (message, context) => emit("info", message, context),
    warn:  (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
  };
}
