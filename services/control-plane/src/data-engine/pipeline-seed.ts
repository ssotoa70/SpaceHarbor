/**
 * DataEngine pipeline bootstrap seeding.
 *
 * On first-boot with an empty config, the control-plane loads a default
 * pipeline list from `default-pipelines.json` that ships inside the
 * container image. The sentinel (`dataEnginePipelinesSeeded`) guarantees
 * the seed runs exactly once per install — if an admin later deletes the
 * pipelines via the Settings UI, they are NOT re-seeded on the next
 * restart. The sentinel is persisted alongside the pipelines themselves
 * via the file-backed SettingsStore.
 *
 * The seed is pure config (ships as JSON, not code). Admins can override
 * every field at any time via PUT /platform/settings. Production deploys
 * either accept the seed defaults as-is, edit via the Settings UI, or
 * replace the JSON file before building the container image.
 *
 * Failure modes:
 *   - Seed file missing      → `{ action: "failed", reason: "..." }`
 *   - Seed file malformed    → `{ action: "failed", reason: "..." }`
 *   - Seed file invalid data → `{ action: "failed", reason: "..." }`
 *
 * In all failure cases the pipelines list remains empty and the sentinel
 * is NOT set, so the next boot can retry once the issue is resolved. The
 * caller logs the reason via the structured logger — this module never
 * writes to console.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validatePipelineConfigList,
  type DataEnginePipelineConfig,
} from "./pipeline-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Default path to the seed file — lives next to this module inside the image. */
export const DEFAULT_SEED_PATH = join(__dirname, "default-pipelines.json");

/**
 * Loader abstraction — exists purely so tests can inject an in-memory
 * loader without touching the filesystem.
 */
export interface SeedLoader {
  load(): unknown;
}

export class FileSeedLoader implements SeedLoader {
  constructor(private readonly path: string = DEFAULT_SEED_PATH) {}
  load(): unknown {
    const raw = readFileSync(this.path, "utf-8");
    return JSON.parse(raw);
  }
}

export type SeedOutcome =
  | { action: "seeded"; pipelines: readonly DataEnginePipelineConfig[] }
  | { action: "skipped"; reason: "already-seeded" | "nonempty-without-sentinel" }
  | { action: "failed"; reason: string };

export interface SeedInputs {
  /** Current pipelines from the operational store (post-load). */
  current: readonly DataEnginePipelineConfig[];
  /** Sentinel flag — true once a successful seed has run. */
  alreadySeeded: boolean;
  /** Loader that reads the seed file (injectable for tests). */
  loader: SeedLoader;
}

/**
 * Decide whether to seed and return the result. Pure function — does NOT
 * mutate any external state. The caller applies the returned pipelines
 * to the operational store and persists along with the sentinel.
 */
export function planSeed(inputs: SeedInputs): SeedOutcome {
  if (inputs.alreadySeeded) {
    return { action: "skipped", reason: "already-seeded" };
  }
  if (inputs.current.length > 0) {
    // Edge case: non-empty list but sentinel is false. This can happen
    // when an older SpaceHarbor version persisted pipelines without the
    // sentinel field. Treat the existing list as admin-managed — don't
    // overwrite. The caller should set the sentinel so this code path
    // doesn't run again.
    return { action: "skipped", reason: "nonempty-without-sentinel" };
  }

  let raw: unknown;
  try {
    raw = inputs.loader.load();
  } catch (err) {
    return {
      action: "failed",
      reason: `could not load seed file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let validated: DataEnginePipelineConfig[];
  try {
    validated = validatePipelineConfigList(raw);
  } catch (err) {
    return {
      action: "failed",
      reason: `seed file failed validation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { action: "seeded", pipelines: validated };
}
