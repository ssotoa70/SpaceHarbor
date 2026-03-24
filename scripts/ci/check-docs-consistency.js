#!/usr/bin/env node
/**
 * check-docs-consistency.js
 *
 * Documentation consistency linter that verifies:
 *   1. All registered route groups have corresponding entries in docs/api-contracts.md.
 *   2. All SPACEHARBOR_* and VAST_* env vars referenced in source appear in .env.example.
 *   3. No forbidden terminology (Trino as primary term) in user-facing files.
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
  const contractsPath = path.join(root, "docs/api-contracts.md");
  if (!fs.existsSync(contractsPath)) {
    console.log("  [skip] docs/api-contracts.md not found (moved to Wiki)\n");
    return;
  }
  const contractsDoc = fs.readFileSync(contractsPath, "utf8");

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
    "NODE_ENV",              // Standard Node.js env var (also in .env.example)
    "VAST_SOURCE_PATH",      // DataEngine function runtime (injected by platform)
    "VAST_ASSET_ID",         // DataEngine function runtime (injected by platform)
    "VAST_PROJECT_ID",       // DataEngine function runtime (injected by platform)
    "VAST_SHOT_ID",          // DataEngine function runtime (injected by platform)
    "VAST_THUMB_PATH",       // DataEngine function runtime (injected by platform)
    "VAST_PROXY_PATH",       // DataEngine function runtime (injected by platform)
    "KAFKA_TOPIC",           // DataEngine function runtime (per-function topic override)
    "KAFKA_COMPLETION_TOPIC", // DataEngine function runtime (completion topic override)
    "KAFKA_FLUSH_TIMEOUT",   // DataEngine function runtime tuning
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

// ─── Check 3: Terminology regression (forbidden terms) ──────────────────────

function checkTerminology() {
  console.log("=== Check 3: Terminology regression (forbidden terms) ===\n");

  // Patterns that indicate forbidden usage of "Trino" as a primary term.
  // Allowed: "Trino-compatible", "via Trino", "VAST Connector for Trino",
  //          deprecated alias comments, backward-compat fallback code.
  const forbiddenPatterns = [
    // "Trino" used as the primary product name (not as a protocol descriptor)
    { regex: /\bTrino\s+DB\b/gi, label: "Trino DB" },
    { regex: /\bTrino\s+Endpoint\b/gi, label: "Trino Endpoint" },
    { regex: /\bTrino\s+client\b/gi, label: "Trino client" },
    { regex: /\bTrino\s+persistence\b/gi, label: "Trino persistence" },
    { regex: /\bTrino\s+REST\b/gi, label: "Trino REST" },
    // "Trino" as standalone noun without qualifier (catches "uses Trino" but not "via Trino")
    // Narrower: only flag when Trino appears as a standalone technology reference
    { regex: /(?:uses?|with|from|to|against|on)\s+Trino(?!\s*[-‐–—]compatible)(?!\s+connector)\b/gi, label: "Trino as primary term" },
  ];

  // User-facing files to scan (docs, config comments, UI)
  const userFacingGlobs = [
    "README.md",
    "CLAUDE.md",
    "CHANGELOG.md",
    "RELEASE.md",
    "docs/**/*.md",
    "services/control-plane/ARCHITECTURE.md",
    "services/web-ui/ARCHITECTURE.md",
    ".env.example",
    ".env.onprem.example",
    ".env.cloud.example",
    "services/web-ui/src/**/*.tsx",
    "services/web-ui/src/**/*.ts",
  ];

  // Files whitelisted for deprecated fallback references only.
  // These files MAY contain "VAST_TRINO_*" in backward-compat code.
  const whitelistedForLegacy = new Set([
    "services/control-plane/src/db/installer.ts",
    "services/control-plane/src/db/migrations",  // prefix match
    "services/control-plane/src/persistence/adapters/vast-persistence.ts",
    "services/scanner-function/function.py",
    "services/openassetio-manager/src/routes/manager.py",
    "scripts/deploy.py",
    "services/control-plane/docker-compose.test.yml",
    "THIRD_PARTY_NOTICES.md",
  ]);

  function isWhitelisted(relPath) {
    return [...whitelistedForLegacy].some((w) => relPath.startsWith(w));
  }

  // Collect files to scan
  const filesToScan = [];
  for (const glob of userFacingGlobs) {
    if (glob.includes("**")) {
      // Recursive pattern — extract base dir and extension
      const parts = glob.split("**");
      const baseDir = parts[0].replace(/\/$/, "");
      const extMatch = parts[1]?.match(/\*(\.\w+)$/);
      const ext = extMatch ? extMatch[1] : ".md";
      const absBase = path.join(root, baseDir);
      if (fs.existsSync(absBase)) {
        filesToScan.push(...collectFiles(absBase, ext));
      }
    } else {
      const absPath = path.join(root, glob);
      if (fs.existsSync(absPath)) {
        filesToScan.push(absPath);
      }
    }
  }

  console.log(`  Scanning ${filesToScan.length} user-facing files`);

  let violations = 0;

  for (const filePath of filesToScan) {
    const relPath = path.relative(root, filePath);
    if (isWhitelisted(relPath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    for (const { regex, label } of forbiddenPatterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        // Find line number
        const upToMatch = content.slice(0, match.index);
        const lineNum = (upToMatch.match(/\n/g) || []).length + 1;
        const lineText = lines[lineNum - 1]?.trim() || "";

        // Skip if the line is a deprecation notice or comment about backward compat
        if (/deprecated|backward.?compat|legacy|fallback/i.test(lineText)) continue;
        // Skip if line contains "Trino-compatible" or "via Trino" (allowed)
        if (/Trino-compatible|via\s+Trino|Connector\s+for\s+Trino/i.test(lineText)) continue;

        console.error(`  [ERROR] ${relPath}:${lineNum}: forbidden term "${label}"`);
        console.error(`         ${lineText}`);
        errors++;
        violations++;
      }
    }
  }

  // Also check for new VAST_TRINO_* env var definitions (not in fallback code)
  const envVarFiles = [".env.example", ".env.onprem.example", ".env.cloud.example"];
  for (const envFile of envVarFiles) {
    const absPath = path.join(root, envFile);
    if (!fs.existsSync(absPath)) continue;

    const content = fs.readFileSync(absPath, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match active (uncommented) env var definitions with VAST_TRINO_ prefix
      if (/^VAST_TRINO_\w+=/.test(line)) {
        console.error(`  [ERROR] ${envFile}:${i + 1}: active VAST_TRINO_* definition (use VAST_DB_* instead)`);
        console.error(`         ${line}`);
        errors++;
        violations++;
      }
    }
  }

  if (violations === 0) {
    console.log("  [ok] No forbidden terminology found");
  }

  console.log("");
}

// ─── Main ───────────────────────────────────────────────────────────────────

checkRouteDocumentation();
checkEnvVarDocumentation();
checkTerminology();

if (errors > 0) {
  console.error(`\n${errors} documentation consistency error(s) found.`);
  process.exit(1);
} else {
  console.log("All documentation consistency checks passed.");
}
