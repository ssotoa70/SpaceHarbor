/**
 * Persistence adapter contract / parity tests.
 *
 * These tests run the same lifecycle operations against LocalPersistenceAdapter
 * and verify that the adapter fulfils the PersistenceAdapter interface contract.
 *
 * The goal is to ensure that the contract stays stable as the codebase evolves,
 * and that the local adapter — which acts as the dev/test fallback for VastPersistenceAdapter
 * — correctly implements every operation expected by the control-plane.
 *
 * No external infrastructure required.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LocalPersistenceAdapter } from "../../src/persistence/adapters/local-persistence.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAdapter(): LocalPersistenceAdapter {
  return new LocalPersistenceAdapter();
}

const BASE_CTX = { correlationId: "parity-test" };

// ---------------------------------------------------------------------------
// createIngestAsset
// ---------------------------------------------------------------------------

describe("persistence parity — createIngestAsset", () => {
  it("returns an asset and a pending job", async () => {
    const adapter = makeAdapter();
    const result = await adapter.createIngestAsset(
      { title: "hero.exr", sourceUri: "file:///vast/hero.exr" },
      BASE_CTX,
    );

    assert.ok(result.asset.id, "asset must have an id");
    assert.equal(result.asset.title, "hero.exr");
    assert.equal(result.asset.sourceUri, "file:///vast/hero.exr");

    assert.ok(result.job.id, "job must have an id");
    assert.equal(result.job.assetId, result.asset.id);
    assert.equal(result.job.status, "pending");
    assert.equal(result.job.leaseOwner, null);
  });

  it("assigns a unique id to each ingested asset", async () => {
    const adapter = makeAdapter();
    const a = await adapter.createIngestAsset(
      { title: "a.exr", sourceUri: "file:///vast/a.exr" },
      BASE_CTX,
    );
    const b = await adapter.createIngestAsset(
      { title: "b.exr", sourceUri: "file:///vast/b.exr" },
      BASE_CTX,
    );
    assert.notEqual(a.asset.id, b.asset.id);
    assert.notEqual(a.job.id, b.job.id);
  });
});

// ---------------------------------------------------------------------------
// getAssetById
// ---------------------------------------------------------------------------

describe("persistence parity — getAssetById", () => {
  it("returns the asset after ingest", async () => {
    const adapter = makeAdapter();
    const { asset } = await adapter.createIngestAsset(
      { title: "get-test.exr", sourceUri: "file:///vast/get-test.exr" },
      BASE_CTX,
    );

    const fetched = await adapter.getAssetById(asset.id);
    assert.ok(fetched, "should return asset by id");
    assert.equal(fetched.id, asset.id);
    assert.equal(fetched.title, "get-test.exr");
  });

  it("returns null for an unknown asset id", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getAssetById("00000000-0000-0000-0000-000000000000");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// getJobById
// ---------------------------------------------------------------------------

describe("persistence parity — getJobById", () => {
  it("returns the job after ingest", async () => {
    const adapter = makeAdapter();
    const { job } = await adapter.createIngestAsset(
      { title: "job-get.exr", sourceUri: "file:///vast/job-get.exr" },
      BASE_CTX,
    );

    const fetched = await adapter.getJobById(job.id);
    assert.ok(fetched, "should return job by id");
    assert.equal(fetched.id, job.id);
    assert.equal(fetched.status, "pending");
  });

  it("returns null for unknown job id", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getJobById("nonexistent-id");
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// claimNextJob
// ---------------------------------------------------------------------------

describe("persistence parity — claimNextJob", () => {
  it("claims a pending job and transitions it to processing", async () => {
    const adapter = makeAdapter();
    await adapter.createIngestAsset(
      { title: "claim-me.exr", sourceUri: "file:///vast/claim-me.exr" },
      BASE_CTX,
    );

    const claimed = await adapter.claimNextJob("worker-01", 60, BASE_CTX);
    assert.ok(claimed, "should claim a pending job");
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.leaseOwner, "worker-01");
    assert.ok(claimed.leaseExpiresAt, "claimed job must have a lease expiry");
  });

  it("returns null when no pending jobs exist", async () => {
    const adapter = makeAdapter();
    const result = await adapter.claimNextJob("worker-01", 30, BASE_CTX);
    assert.equal(result, null);
  });

  it("does not return the same job twice (CAS safety)", async () => {
    const adapter = makeAdapter();
    await adapter.createIngestAsset(
      { title: "cas-test.exr", sourceUri: "file:///vast/cas-test.exr" },
      BASE_CTX,
    );

    const first = await adapter.claimNextJob("worker-A", 60, BASE_CTX);
    const second = await adapter.claimNextJob("worker-B", 60, BASE_CTX);

    assert.ok(first, "first claim should succeed");
    assert.equal(second, null, "second claim on already-claimed job should return null");
  });
});

// ---------------------------------------------------------------------------
// updateJobStatus (CAS)
// ---------------------------------------------------------------------------

describe("persistence parity — updateJobStatus", () => {
  it("transitions from processing to completed when expected status matches", async () => {
    const adapter = makeAdapter();
    const { job } = await adapter.createIngestAsset(
      { title: "status-update.exr", sourceUri: "file:///vast/status-update.exr" },
      BASE_CTX,
    );

    await adapter.claimNextJob("worker-01", 60, BASE_CTX);

    const success = await adapter.updateJobStatus(job.id, "processing", "completed", BASE_CTX);
    assert.equal(success, true, "CAS update should succeed when expected status matches");

    const updated = await adapter.getJobById(job.id);
    assert.ok(updated, "job must still exist");
    assert.equal(updated.status, "completed");
  });

  it("returns false when expected status does not match (stale CAS)", async () => {
    const adapter = makeAdapter();
    const { job } = await adapter.createIngestAsset(
      { title: "cas-stale.exr", sourceUri: "file:///vast/cas-stale.exr" },
      BASE_CTX,
    );

    // Job is still "pending"; attempting CAS from "processing" should fail
    const result = await adapter.updateJobStatus(job.id, "processing", "completed", BASE_CTX);
    assert.equal(result, false, "CAS should fail when expected status does not match actual");

    const unchanged = await adapter.getJobById(job.id);
    assert.ok(unchanged, "job must still exist");
    assert.equal(unchanged.status, "pending", "status must not change on CAS failure");
  });

  it("returns false for an unknown job id", async () => {
    const adapter = makeAdapter();
    const result = await adapter.updateJobStatus(
      "00000000-dead-beef-0000-000000000000",
      "pending",
      "completed",
      BASE_CTX,
    );
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: ingest → claim → complete → verify stats
// ---------------------------------------------------------------------------

describe("persistence parity — full workflow lifecycle", () => {
  it("ingest → claim → complete produces correct WorkflowStats", async () => {
    const adapter = makeAdapter();

    const { asset, job } = await adapter.createIngestAsset(
      { title: "lifecycle.exr", sourceUri: "file:///vast/lifecycle.exr" },
      BASE_CTX,
    );

    const statsAfterIngest = await adapter.getWorkflowStats();
    assert.equal(statsAfterIngest.assets.total, 1);
    assert.equal(statsAfterIngest.jobs.pending, 1);
    assert.equal(statsAfterIngest.jobs.processing, 0);
    assert.equal(statsAfterIngest.jobs.completed, 0);

    await adapter.claimNextJob("worker-01", 60, BASE_CTX);

    const statsAfterClaim = await adapter.getWorkflowStats();
    assert.equal(statsAfterClaim.jobs.pending, 0);
    assert.equal(statsAfterClaim.jobs.processing, 1);

    await adapter.updateJobStatus(job.id, "processing", "completed", BASE_CTX);

    const statsFinal = await adapter.getWorkflowStats();
    assert.equal(statsFinal.jobs.completed, 1);
    assert.equal(statsFinal.jobs.processing, 0);
    assert.equal(statsFinal.jobs.pending, 0);

    // Asset remains retrievable after workflow completes
    const finalAsset = await adapter.getAssetById(asset.id);
    assert.ok(finalAsset, "asset must be retrievable after job completion");
    assert.equal(finalAsset.id, asset.id);
  });

  it("ingest → claim → fail produces failed job count", async () => {
    const adapter = makeAdapter();

    const { job } = await adapter.createIngestAsset(
      { title: "fail-test.exr", sourceUri: "file:///vast/fail-test.exr" },
      BASE_CTX,
    );

    await adapter.claimNextJob("worker-01", 60, BASE_CTX);
    await adapter.updateJobStatus(job.id, "processing", "failed", BASE_CTX);

    const stats = await adapter.getWorkflowStats();
    assert.equal(stats.jobs.failed, 1);
    assert.equal(stats.jobs.completed, 0);
  });
});

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

describe("persistence parity — adapter identity", () => {
  it("reports backend=local", () => {
    const adapter = makeAdapter();
    assert.equal(adapter.backend, "local");
  });
});
