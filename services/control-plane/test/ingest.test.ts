import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app";

test("POST /assets/ingest creates asset and pending workflow job", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/assets/ingest",
    payload: {
      title: "Launch Teaser",
      sourceUri: "s3://bucket/launch-teaser.mov"
    }
  });

  assert.equal(response.statusCode, 201);

  const body = response.json();
  assert.equal(body.asset.title, "Launch Teaser");
  assert.equal(body.asset.sourceUri, "s3://bucket/launch-teaser.mov");
  assert.equal(body.job.status, "pending");
  assert.ok(body.asset.id);
  assert.ok(body.job.id);

  await app.close();
});
