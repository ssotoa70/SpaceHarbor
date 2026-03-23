import type { PersistenceAdapter } from "../persistence/types.js";

export interface LeaseReapingConfig {
  enabled: boolean;
  intervalSeconds: number;
}

export interface LeaseReapingRunSummary {
  nowIso: string;
  requeuedCount: number;
  skipped: boolean;
}

const DEFAULT_INTERVAL_SECONDS = 30;

function parsePositiveInt(value: string | undefined, fallbackValue: number): number {
  if (!value) {
    return fallbackValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
}

export function resolveLeaseReapingConfig(env: NodeJS.ProcessEnv = process.env): LeaseReapingConfig {
  const enabled = (env.SPACEHARBOR_LEASE_REAPING_ENABLED ?? "true").toLowerCase() !== "false";

  return {
    enabled,
    intervalSeconds: parsePositiveInt(env.SPACEHARBOR_LEASE_REAPING_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS)
  };
}

export function createLeaseReapingRunner(
  persistence: PersistenceAdapter,
  env: NodeJS.ProcessEnv = process.env
): {
  config: LeaseReapingConfig;
  start: () => void;
  stop: () => void;
  runNow: (now?: Date) => Promise<LeaseReapingRunSummary>;
} {
  const config = resolveLeaseReapingConfig(env);
  let timer: NodeJS.Timeout | null = null;
  let runInProgress = false;

  const runNow = async (now: Date = new Date()): Promise<LeaseReapingRunSummary> => {
    const nowIso = now.toISOString();
    if (runInProgress) {
      return {
        nowIso,
        requeuedCount: 0,
        skipped: true
      };
    }

    runInProgress = true;
    try {
      await Promise.resolve();
      const requeuedCount = await persistence.reapStaleLeases(nowIso);
      return {
        nowIso,
        requeuedCount,
        skipped: false
      };
    } finally {
      runInProgress = false;
    }
  };

  const start = (): void => {
    if (!config.enabled || timer) {
      return;
    }
    timer = setInterval(() => {
      void runNow().catch(() => undefined);
    }, config.intervalSeconds * 1000);
  };

  const stop = (): void => {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = null;
  };

  return {
    config,
    start,
    stop,
    runNow
  };
}
