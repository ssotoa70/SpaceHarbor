/**
 * Migration 024: function_configs — typed runtime knobs for SpaceHarbor functions.
 *
 * Background
 * ----------
 * Operators tune behavioral knobs (timeouts, concurrency caps, feature flags)
 * without restart. Each setting has a declared type, optional min/max,
 * human-readable label + description + category, and last-edited-by audit.
 *
 * Seed data in this migration is the first consumer: scope="asset-integrity"
 * with six knobs split across Hashing and Keyframes categories. Seed rows
 * are idempotent — re-running the migration does not overwrite current
 * values or last_edited_* metadata.
 *
 * Reader caches in-process for 60s (see config/function-configs-store.ts).
 * DataEngine functions that read these values also use a 60s TTL — UI edits
 * propagate on the next function invocation without redeploy.
 *
 * VAST Database constraints:
 *   - Sort keys permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *
 * Plan reference: docs/superpowers/plans/2026-04-24-phase-6.0-asset-integrity.md
 */

import type { Migration } from "./types.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 24,
  description: "function_configs — typed runtime knobs (+ asset-integrity seed)",
  statements: [
    `CREATE TABLE IF NOT EXISTS ${S}.function_configs (
  scope          VARCHAR(64)   NOT NULL,
  key            VARCHAR(128)  NOT NULL,
  value_type     VARCHAR(32)   NOT NULL,
  value_json     VARCHAR(4000) NOT NULL,
  default_json   VARCHAR(4000) NOT NULL,
  min_json       VARCHAR(256),
  max_json       VARCHAR(256),
  description    VARCHAR(2000) NOT NULL,
  label          VARCHAR(256)  NOT NULL,
  category       VARCHAR(128)  NOT NULL,
  last_edited_by VARCHAR(255),
  last_edited_at TIMESTAMP(6)
)`,

    `ALTER TABLE ${S}.function_configs SET PROPERTIES sorted_by = ARRAY['scope', 'category', 'key']`,

    // Seed — asset-integrity scope. Uses INSERT ... SELECT WHERE NOT EXISTS
    // idiom for idempotency. Re-running never overwrites existing rows.
    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'hash_timeout_seconds', 'duration_seconds', '120', '120', '10', '600',
       'Maximum wall-clock time the hash-generator may spend on a single asset before failing.',
       'Hash generation timeout', 'Hashing', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'hash_timeout_seconds')`,

    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'hash_concurrency_max', 'int', '4', '4', '1', '16',
       'Maximum number of hash-generator invocations that may run in parallel.',
       'Max concurrent hash jobs', 'Hashing', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'hash_concurrency_max')`,

    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'perceptual_hash_enabled', 'bool', 'true', 'true', NULL, NULL,
       'When disabled, only the SHA-256 hash is computed. Perceptual hash adds CPU cost but enables near-duplicate detection.',
       'Perceptual hash enabled', 'Hashing', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'perceptual_hash_enabled')`,

    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'keyframe_count', 'int', '10', '10', '1', '30',
       'Maximum number of I-frames the keyframe-extractor captures per video asset.',
       'Keyframes per video', 'Keyframes', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'keyframe_count')`,

    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'keyframe_extraction_timeout_seconds', 'duration_seconds', '180', '180', '30', '900',
       'Wall-clock ceiling on the keyframe-extractor per asset. Long videos may need higher values.',
       'Keyframe extraction timeout', 'Keyframes', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'keyframe_extraction_timeout_seconds')`,

    `INSERT INTO ${S}.function_configs
  (scope, key, value_type, value_json, default_json, min_json, max_json, description, label, category, last_edited_by, last_edited_at)
SELECT 'asset-integrity', 'keyframe_extraction_enabled', 'bool', 'true', 'true', NULL, NULL,
       'Master switch for keyframe extraction. Disable during ingest bursts if I/O is saturated.',
       'Keyframe extraction enabled', 'Keyframes', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ${S}.function_configs WHERE scope = 'asset-integrity' AND key = 'keyframe_extraction_enabled')`,

    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (24, CURRENT_TIMESTAMP, 'function_configs + asset-integrity seed')`,
  ],
};
