import type { PersistenceAdapter } from "../persistence/types.js";

export type AuditRetentionMode = "dry-run" | "apply";

export interface AuditRetentionConfig {
  enabled: boolean;
  mode: AuditRetentionMode;
  retentionDays: number;
  intervalSeconds: number;
  maxDeletePerRun?: number;
}

export interface AuditRetentionRunSummary {
  mode: AuditRetentionMode;
  cutoffIso: string;
  eligibleCount?: number;
  oldestEligibleAt?: string | null;
  newestEligibleAt?: string | null;
  deletedCount?: number;
  remainingCount?: number;
  skipped: boolean;
}

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_INTERVAL_SECONDS = 3600;

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

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function resolveAuditRetentionConfig(env: NodeJS.ProcessEnv = process.env): AuditRetentionConfig {
  const enabled = (env.ASSETHARBOR_AUDIT_RETENTION_ENABLED ?? "true").toLowerCase() !== "false";
  const rawMode = (env.ASSETHARBOR_AUDIT_RETENTION_MODE ?? "dry-run").toLowerCase();
  const mode: AuditRetentionMode = rawMode === "apply" ? "apply" : "dry-run";

  return {
    enabled,
    mode,
    retentionDays: parsePositiveInt(env.ASSETHARBOR_AUDIT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    intervalSeconds: parsePositiveInt(env.ASSETHARBOR_AUDIT_RETENTION_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS),
    maxDeletePerRun: parseOptionalPositiveInt(env.ASSETHARBOR_AUDIT_RETENTION_MAX_DELETE_PER_RUN)
  };
}

export function computeAuditRetentionCutoffIso(now: Date, retentionDays: number): string {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

export function createAuditRetentionRunner(
  persistence: PersistenceAdapter,
  env: NodeJS.ProcessEnv = process.env
): {
  config: AuditRetentionConfig;
  start: () => void;
  stop: () => void;
  runNow: (now?: Date) => Promise<AuditRetentionRunSummary>;
} {
  const config = resolveAuditRetentionConfig(env);
  let timer: NodeJS.Timeout | null = null;
  let runInProgress = false;

  const runNow = async (now: Date = new Date()): Promise<AuditRetentionRunSummary> => {
    const cutoffIso = computeAuditRetentionCutoffIso(now, config.retentionDays);
    if (runInProgress) {
      return {
        mode: config.mode,
        cutoffIso,
        skipped: true
      };
    }

    runInProgress = true;
    try {
      await Promise.resolve();
      if (config.mode === "dry-run") {
        const preview = persistence.previewAuditRetention(cutoffIso);
        return {
          mode: "dry-run",
          cutoffIso,
          eligibleCount: preview.eligibleCount,
          oldestEligibleAt: preview.oldestEligibleAt,
          newestEligibleAt: preview.newestEligibleAt,
          skipped: false
        };
      }

      const result = persistence.applyAuditRetention(cutoffIso, config.maxDeletePerRun);
      return {
        mode: "apply",
        cutoffIso,
        deletedCount: result.deletedCount,
        remainingCount: result.remainingCount,
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
