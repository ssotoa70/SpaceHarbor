import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runReliabilitySmoke } from "./harness.js";

const artifactDir = path.join(process.cwd(), "artifacts", "reliability");

async function main() {
  const result = await runReliabilitySmoke({
    baseUrl: process.env.ASSETHARBOR_BASE_URL ?? "http://localhost:8080"
  });

  await mkdir(artifactDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = path.join(artifactDir, `smoke-${timestamp}.json`);
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  if (!result.passed) {
    process.stderr.write(`Reliability smoke failed. Artifact: ${artifactPath}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Reliability smoke passed. Artifact: ${artifactPath}\n`);
}

await main();
