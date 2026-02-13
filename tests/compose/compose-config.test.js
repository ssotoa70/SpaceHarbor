const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("docker-compose includes core MVP services", () => {
  const composePath = path.join(process.cwd(), "docker-compose.yml");
  const compose = fs.readFileSync(composePath, "utf8");

  assert.match(compose, /control-plane:/);
  assert.match(compose, /media-worker:/);
  assert.match(compose, /web-ui:/);
});
