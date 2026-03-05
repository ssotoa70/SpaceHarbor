#!/usr/bin/env node
/**
 * check-declared-deps.js
 *
 * Detects packages that are imported in a service's source but only exist in
 * the workspace root node_modules (not declared in the service's package.json).
 *
 * This catches the pattern where `npm install <pkg>` is run from the repo root
 * instead of from the service directory. Node resolution finds the package
 * locally, but `npm ci --prefix services/X` in CI does not install it.
 *
 * Usage: node scripts/ci/check-declared-deps.js
 * Exit 1 if any violations found.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "../..");

const SERVICES = [
  { dir: "services/control-plane", srcGlobs: ["src"] },
  { dir: "services/web-ui", srcGlobs: ["src"] },
];

let violations = 0;

for (const { dir, srcGlobs } of SERVICES) {
  const pkgPath = path.join(root, dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);

  // Collect all third-party imports from source files
  const srcDirs = srcGlobs.map((g) => path.join(root, dir, g)).join(" ");
  let raw = "";
  try {
    raw = execSync(
      `grep -rh --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" ${srcDirs}`,
      { encoding: "utf8" },
    );
  } catch (e) {
    raw = e.stdout || "";
  }

  const imported = new Set(
    raw
      .split("\n")
      .map((l) => {
        const m = l.match(/(?:^|\s)(?:import|from|require)\s*\(?['"]([^.][^'"]*)['"]/);
        return m && m[1];
      })
      .filter(Boolean)
      .map((p) =>
        p.startsWith("@") ? p.split("/").slice(0, 2).join("/") : p.split("/")[0],
      )
      .filter((p) => !p.startsWith("node:")),
  );

  const missing = [...imported].filter((p) => {
    if (declared.has(p)) return false;
    // Only flag if the package actually exists in root node_modules
    try {
      fs.accessSync(path.join(root, "node_modules", p));
      return true;
    } catch {
      return false;
    }
  });

  if (missing.length > 0) {
    console.error(`\n❌ ${dir}: packages imported but not in package.json:`);
    for (const p of missing) {
      console.error(`     ${p}  →  run: npm install ${p} --prefix ${dir}`);
    }
    violations += missing.length;
  } else {
    console.log(`✅ ${dir}: all imports declared`);
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} violation(s) found. These packages resolve locally via the workspace root but will fail in CI.\n`,
  );
  process.exit(1);
}
