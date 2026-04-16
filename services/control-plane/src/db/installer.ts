/**
 * @deprecated Use vast-migrate.py instead. This Trino DDL installer is kept
 * for backwards compatibility only. The canonical migration path is now:
 *
 *   python3 src/db/vast-migrate.py --endpoint <url> --access-key <key> --secret-key <key>
 *
 * Or via the Settings UI "Deploy Database" button (POST /platform/settings/deploy-schema),
 * which calls vast-migrate.py internally using the vastdb Python SDK.
 *
 * This file will be removed in a future release.
 *
 * ---
 *
 * CLI Database Installer (DEPRECATED)
 *
 * Connects to a VAST cluster's Trino endpoint and runs all schema
 * migrations in order, with pre-flight checks and safety features.
 *
 * Usage:
 *   npx tsx src/db/installer.ts \
 *     --trino-endpoint https://trino.vast.example.com:8443 \
 *     --access-key <key> --secret-key <key> \
 *     [--target-version N] [--dry-run] [--schema name] [--help]
 *
 * Or via npm script:
 *   npm run db:install -- --help
 */

import { TrinoClient, TrinoQueryError } from "./trino-client.js";
import { migrations } from "./migrations/index.js";
import type { Migration } from "./migrations/index.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface InstallerArgs {
  trinoEndpoint: string;
  accessKey: string;
  secretKey: string;
  targetVersion?: number;
  dryRun: boolean;
  schema: string;
  help: boolean;
}

function printUsage(): void {
  console.log(`
SpaceHarbor Database Installer

Usage:
  npx tsx src/db/installer.ts [options]

Required:
  --trino-endpoint <url>   Trino endpoint URL
  --access-key <key>       VAST access key
  --secret-key <key>       VAST secret key

Optional:
  --target-version <N>     Stop at this migration version
  --dry-run                Print SQL without executing
  --schema <name>          Schema name (default: "spaceharbor/production")
  --help                   Show this help
`.trim());
}

export function parseArgs(argv: string[]): InstallerArgs {
  const args: InstallerArgs = {
    trinoEndpoint: "",
    accessKey: "",
    secretKey: "",
    dryRun: false,
    schema: "spaceharbor/production",
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--trino-endpoint":
        args.trinoEndpoint = argv[++i] ?? "";
        break;
      case "--access-key":
        args.accessKey = argv[++i] ?? "";
        break;
      case "--secret-key":
        args.secretKey = argv[++i] ?? "";
        break;
      case "--target-version":
        args.targetVersion = parseInt(argv[++i] ?? "", 10);
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--schema":
        args.schema = argv[++i] ?? "";
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Pattern for valid schema names: alphanumeric, underscore, slash, hyphen. */
const VALID_SCHEMA_PATTERN = /^[a-zA-Z0-9/_-]+$/;

/**
 * Validate a schema name before it is interpolated into SQL.
 * Prevents SQL injection via the CLI --schema argument.
 */
function validateSchemaName(schema: string): void {
  if (!schema) {
    throw new Error("Schema name must not be empty");
  }
  if (schema.length > 128) {
    throw new Error(`Schema name too long (${schema.length} chars, max 128)`);
  }
  if (!VALID_SCHEMA_PATTERN.test(schema)) {
    throw new Error(
      `Schema name contains unsafe characters: "${schema}" ` +
      `(only alphanumeric, underscore, slash, and hyphen are allowed)`
    );
  }
}

// ---------------------------------------------------------------------------
// Installer logic
// ---------------------------------------------------------------------------

export async function install(args: InstallerArgs): Promise<{ applied: number; currentVersion: number }> {
  // Validate schema name before any SQL interpolation (C8 fix)
  validateSchemaName(args.schema);

  const client = new TrinoClient({
    endpoint: args.trinoEndpoint,
    accessKey: args.accessKey,
    secretKey: args.secretKey,
    schema: args.schema
  });

  // Pre-flight 1: Health check
  console.log("Pre-flight checks:");
  const health = await client.healthCheck();
  if (!health.reachable) {
    throw new Error(`Trino endpoint ${args.trinoEndpoint} is not reachable`);
  }
  console.log(`  [ok] Trino reachable (version: ${health.version ?? "unknown"})`);

  // Pre-flight 2: Auth check
  if (!args.dryRun) {
    try {
      await client.query("SELECT 1");
      console.log("  [ok] Authentication successful");
    } catch (err) {
      throw new Error(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log("  [skip] Auth check (dry-run mode)");
  }

  // Pre-flight 3: Current schema version
  let currentVersion = 0;
  if (!args.dryRun) {
    try {
      const result = await client.query(
        `SELECT MAX(version) AS max_ver FROM vast."${args.schema}".schema_version`
      );
      if (result.data.length > 0 && result.data[0][0] != null) {
        currentVersion = result.data[0][0] as number;
      }
    } catch {
      // Table doesn't exist yet — version 0
    }
  }
  console.log(`  [ok] Current schema version: ${currentVersion}`);
  console.log("");

  // Filter migrations
  let pending: Migration[] = migrations.filter((m) => m.version > currentVersion);
  if (args.targetVersion != null) {
    pending = pending.filter((m) => m.version <= args.targetVersion!);
  }

  if (pending.length === 0) {
    console.log("No migrations to apply. Schema is up to date.");
    return { applied: 0, currentVersion };
  }

  console.log(`Migrations to apply: ${pending.map((m) => m.version).join(", ")}`);
  console.log("");

  // Execute migrations
  let appliedCount = 0;
  for (const mig of pending) {
    console.log(`--- Migration ${mig.version}: ${mig.description} ---`);

    for (const sql of mig.statements) {
      const label = sql.trim().split("\n")[0].slice(0, 70);

      if (args.dryRun) {
        console.log(`  [dry-run] ${label}`);
        console.log(`    SQL: ${sql.trim().replace(/\n/g, "\n         ")}`);
      } else {
        process.stdout.write(`  ${label}... `);
        try {
          await client.query(sql);
          console.log("done");
        } catch (err) {
          const msg = err instanceof TrinoQueryError ? err.message : String(err);
          console.error(`FAILED`);
          console.error(`  SQL: ${sql.trim()}`);
          console.error(`  Error: ${msg}`);
          console.error("");
          console.error("Re-run the installer to resume from where it left off.");
          throw new Error(`Migration ${mig.version} failed: ${msg}`);
        }
      }
    }

    appliedCount++;
    currentVersion = mig.version;
    console.log("");
  }

  // Summary
  console.log(`Applied ${appliedCount} migration(s). Current version: ${currentVersion}`);
  return { applied: appliedCount, currentVersion };
}

// ---------------------------------------------------------------------------
// Rollback: play `downStatements` in LIFO order down to targetVersion.
// Only migrations that declare downStatements can be rolled back; a missing
// downStatements field on any migration in the chain aborts the rollback.
// ---------------------------------------------------------------------------

export async function rollback(
  args: InstallerArgs & { targetVersion: number },
): Promise<{ rolledBack: number; currentVersion: number }> {
  validateSchemaName(args.schema);
  const client = new TrinoClient({
    endpoint: args.trinoEndpoint,
    accessKey: args.accessKey,
    secretKey: args.secretKey,
  });

  // Discover current version
  const currentVersionRes = await client.query(
    `SELECT MAX(version) AS v FROM vast."${args.schema}".schema_version`,
  );
  const currentVersion = Number(currentVersionRes.data[0]?.[0] ?? 0);
  if (args.targetVersion >= currentVersion) {
    console.log(`Already at version ${currentVersion}; target ${args.targetVersion} is not lower.`);
    return { rolledBack: 0, currentVersion };
  }

  // Select migrations to roll back: versions (target, current]
  const toRollback = migrations
    .filter((m) => m.version > args.targetVersion && m.version <= currentVersion)
    .sort((a, b) => b.version - a.version); // LIFO

  // Verify every one declares downStatements
  const missing = toRollback.filter((m) => !m.downStatements || m.downStatements.length === 0);
  if (missing.length > 0) {
    console.error(
      `Cannot roll back: migrations ${missing.map((m) => m.version).join(", ")} ` +
      `do not declare downStatements. Add down SQL to these migrations or target a different version.`,
    );
    process.exit(1);
  }

  console.log(`Rolling back from v${currentVersion} to v${args.targetVersion} (${toRollback.length} migration(s))`);

  let rolledBack = 0;
  for (const migration of toRollback) {
    console.log(`  rolling back ${migration.version}: ${migration.description}`);
    if (args.dryRun) {
      for (const sql of migration.downStatements!) {
        console.log(`    DRY: ${sql.slice(0, 80)}...`);
      }
      continue;
    }
    for (const sql of migration.downStatements!) {
      try {
        await client.query(sql);
      } catch (err) {
        console.error(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
        // continue — partial rollback is better than halt-and-catch-fire
      }
    }
    rolledBack++;
  }

  console.log(`Rolled back ${rolledBack} migration(s).`);
  return { rolledBack, currentVersion: args.targetVersion };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.warn("DEPRECATED: This Trino DDL installer is deprecated. Use vast-migrate.py instead:");
  console.warn("  python3 src/db/vast-migrate.py --endpoint <url> --access-key <key> --secret-key <key>");
  console.warn("Or use the Settings UI 'Deploy Database' button.\n");

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  // Support environment variable fallbacks so callers don't need to pass
  // secrets as CLI arguments (which are visible in `ps aux`).
  // VAST_TRINO_* are deprecated — prefer VAST_DB_* canonical names.
  if (!args.trinoEndpoint) args.trinoEndpoint = process.env.VAST_DB_ENDPOINT ?? process.env.VAST_TRINO_ENDPOINT ?? "";
  if (!args.accessKey) args.accessKey = process.env.VAST_DB_USERNAME ?? process.env.VAST_TRINO_USERNAME ?? process.env.VAST_ACCESS_KEY ?? "";
  if (!args.secretKey) args.secretKey = process.env.VAST_DB_PASSWORD ?? process.env.VAST_TRINO_PASSWORD ?? process.env.VAST_SECRET_KEY ?? "";
  if (process.env.VAST_TRINO_ENDPOINT && !process.env.VAST_DB_ENDPOINT) {
    console.warn("DEPRECATED: VAST_TRINO_ENDPOINT will be removed in a future release. Use VAST_DB_ENDPOINT instead.");
  }
  if ((process.env.VAST_TRINO_USERNAME || process.env.VAST_TRINO_PASSWORD) && !(process.env.VAST_DB_USERNAME || process.env.VAST_DB_PASSWORD)) {
    console.warn("DEPRECATED: VAST_TRINO_USERNAME/PASSWORD will be removed. Use VAST_DB_USERNAME/PASSWORD instead.");
  }

  const missing: string[] = [];
  if (!args.trinoEndpoint) missing.push("--trino-endpoint or VAST_DB_ENDPOINT");
  if (!args.accessKey) missing.push("--access-key or VAST_DB_USERNAME");
  if (!args.secretKey) missing.push("--secret-key or VAST_DB_PASSWORD");

  if (missing.length > 0) {
    console.error(`Error: missing required arguments: ${missing.join(", ")}`);
    console.error("Run with --help for usage.");
    process.exit(1);
  }

  try {
    // Rollback mode — first non-flag arg of "rollback" triggers it.
    const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== "-h");
    if (positional[0] === "rollback") {
      if (args.targetVersion === undefined) {
        console.error("rollback requires --target-version <N>");
        process.exit(1);
      }
      await rollback(args as InstallerArgs & { targetVersion: number });
    } else {
      await install(args);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  main();
}
