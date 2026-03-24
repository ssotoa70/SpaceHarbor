#!/usr/bin/env node
/**
 * check-docs-consistency.js
 *
 * Documentation consistency linter that verifies:
 *   1. All registered route groups have corresponding entries in docs/api-contracts.md.
 *   2. All SPACEHARBOR_* and VAST_* env vars referenced in source appear in .env.example.
 *
 * Usage: node scripts/ci/check-docs-consistency.js
 * Exit 1 if any violations found.
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

let errors = 0;
let warnings = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

function readFile(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function collectFiles(dir, ext, acc = []) {
  const abs = path.isAbsolute(dir) ? dir : path.join(root, dir);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, ext, acc);
    } else if (entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

// ─── Check 1: Route documentation in api-contracts.md ───────────────────────

function checkRouteDocumentation() {
  console.log("=== Check 1: Route documentation in api-contracts.md ===\n");

  const appSource = readFile("services/control-plane/src/app.ts");
  const contractsDoc = readFile("docs/api-contracts.md");

  // Parse register*Route(s) calls from app.ts
  const registerCalls = appSource.match(/register\w+(?:Route|Routes)\b/g) || [];
  const uniqueRegistrations = [...new Set(registerCalls)];

  console.log(`  Found ${uniqueRegistrations.length} route registrations in app.ts`);

  // Map registration function names to route file basenames
  // e.g. registerApprovalRoutes -> approval, registerAssetsRoute -> assets
  const routeFileMap = {};
  for (const funcName of uniqueRegistrations) {
    const base = funcName
      .replace(/^register/, "")
      .replace(/Routes?$/, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
    routeFileMap[funcName] = base;
  }

  // Internal/infrastructure routes that do not need api-contracts entries.
  // - health: infrastructure probe, not a business API
  // - events / vast-events: internal event processing endpoints consumed by
  //   workers and the VAST event broker; documented in architecture docs rather
  //   than the public api-contracts.
  const exemptRouteGroups = new Set(["health", "events", "vast-events"]);

  // For each route file, extract the route paths and check api-contracts.md
  const routesDir = path.join(root, "services/control-plane/src/routes");

  for (const [funcName, baseName] of Object.entries(routeFileMap)) {
    if (exemptRouteGroups.has(baseName)) {
      console.log(`  [skip] ${funcName} (${baseName}) -- exempt`);
      continue;
    }

    // Find the route file (try exact name, then with 's' suffix, then kebab variants)
    const candidates = [
      `${baseName}.ts`,
      `${baseName}s.ts`,
    ];
    let routeFile = null;
    for (const candidate of candidates) {
      const full = path.join(routesDir, candidate);
      if (fs.existsSync(full)) {
        routeFile = full;
        break;
      }
    }

    if (!routeFile) {
      console.error(`  [ERROR] ${funcName}: route file not found (tried ${candidates.join(", ")})`);
      errors++;
      continue;
    }

    const routeSource = fs.readFileSync(routeFile, "utf8");

    // Extract route path strings from the source.
    // Patterns:
    //   withPrefix(prefix, "/some/path")
    //   withPrefix("", "/some/path")
    //   withPrefix("/api/v1", "/some/path")
    //   `${prefix}/some/path`
    //   "/api/v1/some/path"  (literal registration)
    const paths = new Set();

    // Pattern 1: withPrefix(anything, "/path")
    const withPrefixRe = /withPrefix\([^,]+,\s*["'`]([^"'`]+)["'`]\)/g;
    let m;
    while ((m = withPrefixRe.exec(routeSource)) !== null) {
      paths.add(m[1]);
    }

    // Pattern 2: template literal `${prefix}/path` or `${prefix}/path/more`
    const templateRe = /\$\{prefix\}(\/[^`"']+)/g;
    while ((m = templateRe.exec(routeSource)) !== null) {
      // Clean up: remove trailing quote/backtick residue
      const p = m[1].replace(/[`"'\s,;]/g, "");
      paths.add(p);
    }

    // Pattern 3: literal string "/api/v1/path" registered directly (queue, outbox, dlq, metrics)
    const literalRouteRe = /app\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\(\s*["'`](\/api\/v1\/[^"'`]+)["'`]/g;
    while ((m = literalRouteRe.exec(routeSource)) !== null) {
      // Normalize to just the path portion after /api/v1
      const fullPath = m[2];
      const stripped = fullPath.replace(/^\/api\/v1/, "");
      if (stripped) {
        paths.add(stripped);
      }
    }

    if (paths.size === 0) {
      console.error(`  [ERROR] ${funcName}: no route paths found in ${path.basename(routeFile)}`);
      errors++;
      continue;
    }

    // Check that each route path (normalized) appears in api-contracts.md
    // Normalize: strip param placeholders for matching (e.g. :id -> :id stays, but we search broadly)
    let allFound = true;
    for (const routePath of paths) {
      // Build search patterns: try the path as-is, and also the /api/v1 prefixed version
      const searchVariants = [
        routePath,
        `/api/v1${routePath}`,
      ];

      // For paths with params like :id, also try a regex-style search
      // Strip param names to create a pattern (e.g. /jobs/:id -> /jobs/)
      const found = searchVariants.some((variant) => contractsDoc.includes(variant));

      if (!found) {
        // Try a looser match: strip params and check if the base path is documented
        const basePath = routePath.replace(/\/:[^/]+/g, "");
        const looseVariants = [
          basePath,
          `/api/v1${basePath}`,
        ];
        const looseFound = looseVariants.some((v) => v.length > 1 && contractsDoc.includes(v));

        if (!looseFound) {
          console.error(`  [ERROR] ${funcName}: route "${routePath}" not found in api-contracts.md`);
          errors++;
          allFound = false;
        }
      }
    }

    if (allFound) {
      console.log(`  [ok] ${funcName} (${paths.size} paths)`);
    }
  }

  console.log("");
}

// ─── Check 2: Env vars documented in .env.example ───────────────────────────

function checkEnvVarDocumentation() {
  console.log("=== Check 2: Env vars documented in .env.example ===\n");

  const envExample = readFile(".env.example");

  // Env var name patterns to scan for
  const envVarPatterns = [
    // TypeScript: process.env.VAR_NAME
    { regex: /process\.env\.([A-Z][A-Z0-9_]+)/g, ext: ".ts" },
    // Python: os.environ.get("VAR_NAME") or os.environ["VAR_NAME"]
    { regex: /os\.environ(?:\.get)?\s*\(\s*["']([A-Z][A-Z0-9_]+)["']/g, ext: ".py" },
    { regex: /os\.environ\["([A-Z][A-Z0-9_]+)"\]/g, ext: ".py" },
  ];

  // Prefixes of env vars we care about documenting
  const trackedPrefixes = [
    "SPACEHARBOR_",
    "VAST_",
    "OPENASSETIO_",
    "CONTROL_PLANE_",
    "WORKER_",
    "VITE_",
    "KAFKA_",
    "DEV_MODE",
    "OCIO_CONFIG_PATH",
    "VAST_DB_INTEGRATION",
    "PORT",
    "HOST",
  ];

  // Env vars that are standard/runtime and should be excluded.
  // DataEngine function runtime vars (VAST_SOURCE_PATH, VAST_ASSET_ID, etc.)
  // are injected by the VAST DataEngine platform, not user-configured.
  const exemptVars = new Set([
    "NODE_ENV",              // Standard Node.js environment variable
    "VAST_SOURCE_PATH",      // DataEngine function runtime (injected by platform)
    "VAST_ASSET_ID",         // DataEngine function runtime (injected by platform)
    "VAST_THUMB_PATH",       // DataEngine function runtime (injected by platform)
    "VAST_PROXY_PATH",       // DataEngine function runtime (injected by platform)
    "KAFKA_TOPIC",           // DataEngine function runtime (per-function topic override)
    "KAFKA_COMPLETION_TOPIC", // DataEngine function runtime (completion topic override)
  ]);

  // Collect source directories (exclude test files and node_modules)
  const sourceDirs = [
    "services/control-plane/src",
    "services/media-worker/worker",
    "services/scanner-function",
    "services/openassetio-manager/src",
    "services/dataengine-functions",
  ];

  const foundVars = new Map(); // varName -> [file locations]

  for (const dir of sourceDirs) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) continue;

    // Collect .ts and .py source files (skip test dirs and node_modules)
    const tsFiles = collectFiles(absDir, ".ts").filter(
      (f) => !f.includes("node_modules") && !f.includes("/test/") && !f.includes(".test.")
    );
    const pyFiles = collectFiles(absDir, ".py").filter(
      (f) => !f.includes("node_modules") && !f.includes("/test") && !f.includes("_test.") && !f.includes("test_")
    );

    const allFiles = [...tsFiles, ...pyFiles];

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      const relPath = path.relative(root, filePath);

      for (const { regex, ext } of envVarPatterns) {
        if (!filePath.endsWith(ext)) continue;
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const varName = match[1];
          if (!foundVars.has(varName)) {
            foundVars.set(varName, []);
          }
          foundVars.get(varName).push(relPath);
        }
      }
    }
  }

  // Filter to tracked prefixes and check against .env.example
  const tracked = [...foundVars.entries()].filter(([varName]) => {
    if (exemptVars.has(varName)) return false;
    return trackedPrefixes.some((prefix) => varName.startsWith(prefix) || varName === prefix);
  });

  console.log(`  Found ${tracked.length} tracked env vars across source files`);

  let allPresent = true;
  const missing = [];

  for (const [varName, locations] of tracked) {
    if (envExample.includes(varName)) {
      continue;
    }
    missing.push({ varName, locations });
    allPresent = false;
  }

  if (missing.length > 0) {
    for (const { varName, locations } of missing) {
      const uniqueLocs = [...new Set(locations)];
      console.error(`  [ERROR] ${varName} not in .env.example (used in ${uniqueLocs.slice(0, 3).join(", ")})`);
      errors++;
    }
  }

  if (allPresent) {
    console.log("  [ok] All tracked env vars found in .env.example");
  }

  console.log("");
}

// ─── Main ───────────────────────────────────────────────────────────────────

checkRouteDocumentation();
checkEnvVarDocumentation();

if (errors > 0) {
  console.error(`\n${errors} documentation consistency error(s) found.`);
  process.exit(1);
} else {
  console.log("All documentation consistency checks passed.");
}
