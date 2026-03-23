/**
 * Migration 011: IAM Tables — Users, Memberships, Global Roles, API Keys
 *
 * Creates the persistence layer for Identity & Access Management.
 * Part of Phase 1 — Security Foundation.
 *
 * Tables:
 *   - iam_users: user identity records (IdP-synced or locally created)
 *   - iam_project_memberships: project-scoped role bindings
 *   - iam_global_roles: global role assignments (administrator, super_admin, platform_operator)
 *   - iam_api_keys: hashed API key storage with expiration
 *   - iam_refresh_tokens: opaque refresh token storage for local auth
 *
 * VAST Database constraints:
 *   - Sort keys are permanent (max 4 columns)
 *   - No recursive CTEs
 *   - TIMESTAMP(6) precision
 *   - Batch INSERTs preferred
 */

import type { Migration } from "./types.js";
import { TrinoClient } from "../trino-client.js";

const S = 'vast."spaceharbor/production"';

export const migration: Migration = {
  version: 11,
  description: "IAM tables: users, project memberships, global roles, API keys",
  statements: [
    // -----------------------------------------------------------------------
    // IAM Users — identity records
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.iam_users (
  id                    VARCHAR(36)    NOT NULL,
  external_id           VARCHAR(255),
  email                 VARCHAR(255)   NOT NULL,
  display_name          VARCHAR(255)   NOT NULL,
  avatar_url            VARCHAR(1024),
  status                VARCHAR(20)    NOT NULL,
  password_hash         VARCHAR(256),
  auth_method           VARCHAR(20)    NOT NULL,
  must_change_password  BOOLEAN        NOT NULL,
  created_at            TIMESTAMP(6)   NOT NULL,
  updated_at            TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.iam_users SET PROPERTIES sorted_by = ARRAY['id']`,

    // -----------------------------------------------------------------------
    // IAM Project Memberships — project-scoped role bindings
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.iam_project_memberships (
  id                VARCHAR(36)    NOT NULL,
  user_id           VARCHAR(36)    NOT NULL,
  project_id        VARCHAR(36)    NOT NULL,
  tenant_id         VARCHAR(36)    NOT NULL,
  role              VARCHAR(50)    NOT NULL,
  granted_by        VARCHAR(36)    NOT NULL,
  granted_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.iam_project_memberships SET PROPERTIES sorted_by = ARRAY['user_id', 'project_id']`,

    // -----------------------------------------------------------------------
    // IAM Global Roles — system-wide role assignments
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.iam_global_roles (
  user_id           VARCHAR(36)    NOT NULL,
  role              VARCHAR(50)    NOT NULL,
  granted_by        VARCHAR(36)    NOT NULL,
  granted_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.iam_global_roles SET PROPERTIES sorted_by = ARRAY['user_id']`,

    // -----------------------------------------------------------------------
    // IAM API Keys — hashed key storage with expiration
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.iam_api_keys (
  id                VARCHAR(36)    NOT NULL,
  key_hash          VARCHAR(255)   NOT NULL,
  key_salt          VARCHAR(64)    NOT NULL,
  owner_id          VARCHAR(36)    NOT NULL,
  label             VARCHAR(255),
  scopes            VARCHAR(1024),
  expires_at        TIMESTAMP(6),
  created_at        TIMESTAMP(6)   NOT NULL,
  last_used_at      TIMESTAMP(6),
  revoked           BOOLEAN        NOT NULL
)`,

    `ALTER TABLE ${S}.iam_api_keys SET PROPERTIES sorted_by = ARRAY['owner_id', 'created_at']`,

    // -----------------------------------------------------------------------
    // IAM Refresh Tokens — opaque token storage for local auth
    // Phase 2.3.2: Local Auth Credentials
    // -----------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS ${S}.iam_refresh_tokens (
  token_hash        VARCHAR(128)   NOT NULL,
  user_id           VARCHAR(36)    NOT NULL,
  expires_at        TIMESTAMP(6)   NOT NULL,
  revoked_at        TIMESTAMP(6),
  created_at        TIMESTAMP(6)   NOT NULL
)`,

    `ALTER TABLE ${S}.iam_refresh_tokens SET PROPERTIES sorted_by = ARRAY['token_hash']`,

    // -----------------------------------------------------------------------
    // Version record
    // -----------------------------------------------------------------------
    `INSERT INTO ${S}.schema_version (version, applied_at, description) VALUES (11, CURRENT_TIMESTAMP, 'IAM tables: users, project memberships, global roles, API keys')`
  ]
};

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const endpoint = process.env.VAST_TRINO_ENDPOINT;
  if (!endpoint) {
    console.error("ERROR: VAST_TRINO_ENDPOINT is not set");
    process.exit(1);
  }

  const client = new TrinoClient({
    endpoint,
    accessKey: process.env.VAST_ACCESS_KEY ?? "",
    secretKey: process.env.VAST_SECRET_KEY ?? ""
  });

  console.log(`Running migration ${migration.version}: ${migration.description}`);
  for (const sql of migration.statements) {
    const label = sql.trim().split("\n")[0].slice(0, 60);
    process.stdout.write(`  ${label}... `);
    try {
      await client.query(sql);
      console.log("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`(${msg.split("\n")[0]})`);
    }
  }
  console.log("Migration 011 complete.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  run().catch((err: unknown) => {
    console.error("Migration 011 failed:", err);
    process.exit(1);
  });
}
