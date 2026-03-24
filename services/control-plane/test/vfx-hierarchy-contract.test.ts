/**
 * VFX Hierarchy Contract Tests
 *
 * Tests the Project → Sequence → Shot → Version → Approval hierarchy.
 * Runs against LocalPersistenceAdapter (always) and MockVastAdapter (always).
 * VastDbAdapter tests are integration-only — skipped unless VAST_DB_ENDPOINT is set.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import {
  ReferentialIntegrityError,
  ImmutabilityViolationError
} from "../src/persistence/types.js";
import type { VfxHierarchyAdapter } from "../src/persistence/types.js";

const CTX = { correlationId: "test-correlation-id" };

function makeAdapters(): Array<{ name: string; adapter: VfxHierarchyAdapter }> {
  return [{ name: "LocalAdapter", adapter: new LocalPersistenceAdapter() }];
}

// ---------------------------------------------------------------------------
// Test 1: createProject returns Project with generated UUID
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createProject returns Project with generated UUID`, async () => {
    const project = await adapter.createProject(
      {
        code: "PROJ_NOVA",
        name: "Project Nova",
        type: "feature",
        status: "active"
      },
      CTX
    );

    assert.ok(project.id, "project.id should be set");
    assert.match(
      project.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "project.id should be a UUID"
    );
    assert.equal(project.code, "PROJ_NOVA");
    assert.equal(project.name, "Project Nova");
    assert.equal(project.type, "feature");
    assert.equal(project.status, "active");
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);
  });
}

// ---------------------------------------------------------------------------
// Test 2: createSequence with valid projectId succeeds
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createSequence with valid projectId succeeds`, async () => {
    const project = await adapter.createProject(
      { code: "P1", name: "P1", type: "feature", status: "active" },
      CTX
    );

    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_010", status: "active" },
      CTX
    );

    assert.ok(seq.id);
    assert.equal(seq.projectId, project.id);
    assert.equal(seq.code, "SEQ_010");
    assert.equal(seq.shotCount, 0);
  });
}

// ---------------------------------------------------------------------------
// Test 3: createSequence with non-existent projectId throws ReferentialIntegrityError
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createSequence with non-existent projectId throws ReferentialIntegrityError`, async () => {
    await assert.rejects(
      () =>
        adapter.createSequence(
          { projectId: "00000000-0000-0000-0000-000000000000", code: "SEQ_999", status: "active" },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 4: createShot with valid projectId + sequenceId succeeds
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createShot with valid projectId + sequenceId succeeds`, async () => {
    const project = await adapter.createProject(
      { code: "P2", name: "P2", type: "episodic", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_020", status: "active" },
      CTX
    );

    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH010",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1100,
        frameCount: 100
      },
      CTX
    );

    assert.ok(shot.id);
    assert.equal(shot.projectId, project.id);
    assert.equal(shot.sequenceId, seq.id);
    assert.equal(shot.code, "SH010");
    assert.equal(shot.frameCount, 100);
  });
}

// ---------------------------------------------------------------------------
// Test 5: createVersion with valid shotId auto-assigns versionNumber = 1
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersion with valid shotId auto-assigns versionNumber = 1`, async () => {
    const project = await adapter.createProject(
      { code: "P3", name: "P3", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_030", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH020",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );

    assert.ok(version.id);
    assert.equal(version.versionNumber, 1);
    assert.equal(version.versionLabel, "v001");
    assert.equal(version.status, "draft");
    assert.equal(version.shotId, shot.id);
    assert.equal(version.publishedAt, null);
  });
}

// ---------------------------------------------------------------------------
// Test 6: second createVersion on same shot auto-assigns versionNumber = 2
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] second createVersion on same shot auto-assigns versionNumber = 2`, async () => {
    const project = await adapter.createProject(
      { code: "P4", name: "P4", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_040", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH030",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const versionInput = {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: seq.id,
      status: "draft" as const,
      mediaType: "exr_sequence" as const,
      createdBy: "artist@studio.com"
    };

    await adapter.createVersion({ ...versionInput, versionLabel: "v001" }, CTX);
    const v2 = await adapter.createVersion({ ...versionInput, versionLabel: "v002" }, CTX);

    assert.equal(v2.versionNumber, 2);
    assert.equal(v2.versionLabel, "v002");
  });
}

// ---------------------------------------------------------------------------
// Test 7: publishVersion sets publishedAt and transitions status to "published"
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] publishVersion sets publishedAt and transitions status to "published"`, async () => {
    const project = await adapter.createProject(
      { code: "P5", name: "P5", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_050", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH040",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );

    const published = await adapter.publishVersion(version.id, CTX);

    assert.ok(published, "publishVersion should return the updated version");
    assert.equal(published!.status, "published");
    assert.ok(published!.publishedAt, "publishedAt should be set");
  });
}

// ---------------------------------------------------------------------------
// Test 8: second publishVersion on already-published version throws ImmutabilityViolationError
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] publishVersion on already-published version throws ImmutabilityViolationError`, async () => {
    const project = await adapter.createProject(
      { code: "P6", name: "P6", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_060", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH050",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    await adapter.publishVersion(version.id, CTX);

    await assert.rejects(
      () => adapter.publishVersion(version.id, CTX),
      ImmutabilityViolationError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 9: createVersionApproval with action "approve" persists and returns VersionApproval
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersionApproval with action "approve" persists and returns VersionApproval`, async () => {
    const project = await adapter.createProject(
      { code: "P7", name: "P7", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_070", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH060",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );

    const approval = await adapter.createVersionApproval(
      {
        versionId: version.id,
        shotId: shot.id,
        projectId: project.id,
        action: "approve",
        performedBy: "supervisor@studio.com",
        role: "supervisor"
      },
      CTX
    );

    assert.ok(approval.id);
    assert.equal(approval.versionId, version.id);
    assert.equal(approval.action, "approve");
    assert.equal(approval.performedBy, "supervisor@studio.com");
    assert.ok(approval.at);
  });
}

// ---------------------------------------------------------------------------
// Test 10: listVersionsByShot returns versions ordered by versionNumber ascending
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] listVersionsByShot returns versions ordered by versionNumber ascending`, async () => {
    const project = await adapter.createProject(
      { code: "P8", name: "P8", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_080", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH070",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const base = {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: seq.id,
      status: "draft" as const,
      mediaType: "exr_sequence" as const,
      createdBy: "artist@studio.com"
    };

    await adapter.createVersion({ ...base, versionLabel: "v001" }, CTX);
    await adapter.createVersion({ ...base, versionLabel: "v002" }, CTX);
    await adapter.createVersion({ ...base, versionLabel: "v003" }, CTX);

    const versions = await adapter.listVersionsByShot(shot.id);

    assert.equal(versions.length, 3);
    assert.equal(versions[0].versionNumber, 1);
    assert.equal(versions[1].versionNumber, 2);
    assert.equal(versions[2].versionNumber, 3);
  });
}

// ---------------------------------------------------------------------------
// Test 11: listShotsBySequence returns shots for that sequence only
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] listShotsBySequence returns shots for that sequence only`, async () => {
    const project = await adapter.createProject(
      { code: "P9", name: "P9", type: "feature", status: "active" },
      CTX
    );
    const seqA = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_090A", status: "active" },
      CTX
    );
    const seqB = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_090B", status: "active" },
      CTX
    );

    const shotBase = {
      projectId: project.id,
      status: "active" as const,
      frameRangeStart: 1001,
      frameRangeEnd: 1048,
      frameCount: 48
    };

    await adapter.createShot({ ...shotBase, sequenceId: seqA.id, code: "SH_A1" }, CTX);
    await adapter.createShot({ ...shotBase, sequenceId: seqA.id, code: "SH_A2" }, CTX);
    await adapter.createShot({ ...shotBase, sequenceId: seqB.id, code: "SH_B1" }, CTX);

    const shotsA = await adapter.listShotsBySequence(seqA.id);
    const shotsB = await adapter.listShotsBySequence(seqB.id);

    assert.equal(shotsA.length, 2);
    assert.equal(shotsB.length, 1);
    assert.ok(shotsA.every((s) => s.sequenceId === seqA.id));
  });
}

// ---------------------------------------------------------------------------
// Test 12: Full hierarchy traversal — project → sequence → shot → version → approve
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] full hierarchy traversal: project → sequence → shot → version → approve`, async () => {
    // Project
    const project = await adapter.createProject(
      { code: "FULL_TRAVERSE", name: "Full Traversal Test", type: "vfx_only", status: "active" },
      CTX
    );
    assert.ok(project.id);

    // Sequence
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_100", episode: "EP01", status: "active" },
      CTX
    );
    assert.equal(seq.projectId, project.id);
    assert.equal(seq.episode, "EP01");

    // Shot
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH100",
        name: "Hero enters facility",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1200,
        frameCount: 200,
        priority: "high"
      },
      CTX
    );
    assert.equal(shot.sequenceId, seq.id);
    assert.equal(shot.priority, "high");

    // Version
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    assert.equal(version.versionNumber, 1);

    // Approve (submit_for_review then approve)
    const reviewApproval = await adapter.createVersionApproval(
      {
        versionId: version.id,
        shotId: shot.id,
        projectId: project.id,
        action: "submit_for_review",
        performedBy: "artist@studio.com",
        role: "artist"
      },
      CTX
    );
    assert.equal(reviewApproval.action, "submit_for_review");

    const finalApproval = await adapter.createVersionApproval(
      {
        versionId: version.id,
        shotId: shot.id,
        projectId: project.id,
        action: "approve",
        performedBy: "supervisor@studio.com",
        role: "supervisor"
      },
      CTX
    );
    assert.equal(finalApproval.action, "approve");

    // Verify audit trail
    const approvals = await adapter.listApprovalsByVersion(version.id);
    assert.equal(approvals.length, 2);
  });
}

// ---------------------------------------------------------------------------
// SERGIO-138: ReviewStatus tests (R2-A)
// ---------------------------------------------------------------------------

// Helper: build a minimal project + sequence + shot for a given adapter
async function makeShot(adapter: VfxHierarchyAdapter) {
  const project = await adapter.createProject(
    { code: "RS_TEST", name: "ReviewStatus Test", type: "feature", status: "active" },
    CTX
  );
  const seq = await adapter.createSequence(
    { projectId: project.id, code: "SEQ010", status: "active" },
    CTX
  );
  const shot = await adapter.createShot(
    {
      projectId: project.id,
      sequenceId: seq.id,
      code: "SH010",
      status: "active",
      frameRangeStart: 1001,
      frameRangeEnd: 1048,
      frameCount: 48
    },
    CTX
  );
  return { project, seq, shot };
}

// Test 1: createVersion defaults reviewStatus to "wip"
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersion defaults reviewStatus to "wip"`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    assert.equal(version.reviewStatus, "wip");
  });
}

// Test 2: updateVersionReviewStatus changes status to "internal_review"
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] updateVersionReviewStatus changes status to "internal_review"`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    const updated = await adapter.updateVersionReviewStatus(version.id, "internal_review", CTX);
    assert.ok(updated, "should return updated version");
    assert.equal(updated!.reviewStatus, "internal_review");
    assert.equal(updated!.id, version.id);
  });
}

// Test 3: updateVersionReviewStatus on non-existent version returns null
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] updateVersionReviewStatus on non-existent version returns null`, async () => {
    const result = await adapter.updateVersionReviewStatus("non-existent-id", "approved", CTX);
    assert.equal(result, null);
  });
}

// Test 4: updateVersionReviewStatus to "approved" persists correctly
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] updateVersionReviewStatus to "approved" persists correctly`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "review",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    await adapter.updateVersionReviewStatus(version.id, "approved", CTX);
    const fetched = await adapter.getVersionById(version.id);
    assert.ok(fetched, "version should still exist");
    assert.equal(fetched!.reviewStatus, "approved");
  });
}

// Test 5: published version CAN have reviewStatus updated (immutability applies to publishedAt only)
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] published version can have reviewStatus updated`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com"
      },
      CTX
    );
    await adapter.publishVersion(version.id, CTX);
    const updated = await adapter.updateVersionReviewStatus(version.id, "client_review", CTX);
    assert.ok(updated, "should return updated version");
    assert.equal(updated!.reviewStatus, "client_review");
  });
}

// ---------------------------------------------------------------------------
// SERGIO-139: Frame Handles (headHandle + tailHandle)
// ---------------------------------------------------------------------------

// Test 1: createVersion → headHandle and tailHandle default to null
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersion defaults headHandle and tailHandle to null`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      { shotId: shot.id, projectId: project.id, sequenceId: seq.id, versionLabel: "v001", status: "draft", mediaType: "exr_sequence", createdBy: "artist@studio.com" },
      CTX
    );
    assert.strictEqual(version.headHandle, null);
    assert.strictEqual(version.tailHandle, null);
  });
}

// Test 2: createVersion with headHandle=8, tailHandle=8 → values persisted
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersion persists explicit headHandle and tailHandle`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      { shotId: shot.id, projectId: project.id, sequenceId: seq.id, versionLabel: "v001", status: "draft", mediaType: "exr_sequence", createdBy: "artist@studio.com", headHandle: 8, tailHandle: 8 },
      CTX
    );
    assert.strictEqual(version.headHandle, 8);
    assert.strictEqual(version.tailHandle, 8);
  });
}

// Test 3: updateVersionTechnicalMetadata with frame_head_handle=16, frame_tail_handle=16
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] updateVersionTechnicalMetadata updates headHandle and tailHandle`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      { shotId: shot.id, projectId: project.id, sequenceId: seq.id, versionLabel: "v001", status: "draft", mediaType: "exr_sequence", createdBy: "artist@studio.com" },
      CTX
    );
    const updated = await adapter.updateVersionTechnicalMetadata(version.id, { frame_head_handle: 16, frame_tail_handle: 16 }, CTX);
    assert.ok(updated, "should return updated version");
    assert.strictEqual(updated!.headHandle, 16);
    assert.strictEqual(updated!.tailHandle, 16);
  });
}

// Test 4: getVersionById returns headHandle and tailHandle fields
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] getVersionById returns headHandle and tailHandle`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      { shotId: shot.id, projectId: project.id, sequenceId: seq.id, versionLabel: "v001", status: "draft", mediaType: "exr_sequence", createdBy: "artist@studio.com", headHandle: 4, tailHandle: 4 },
      CTX
    );
    const fetched = await adapter.getVersionById(version.id);
    assert.ok(fetched);
    assert.strictEqual(fetched!.headHandle, 4);
    assert.strictEqual(fetched!.tailHandle, 4);
  });
}

// Test 5: headHandle and tailHandle survive publishVersion
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] headHandle and tailHandle survive publishVersion`, async () => {
    const { project, seq, shot } = await makeShot(adapter);
    const version = await adapter.createVersion(
      { shotId: shot.id, projectId: project.id, sequenceId: seq.id, versionLabel: "v001", status: "draft", mediaType: "exr_sequence", createdBy: "artist@studio.com", headHandle: 8, tailHandle: 8 },
      CTX
    );
    const published = await adapter.publishVersion(version.id, CTX);
    assert.ok(published);
    assert.strictEqual(published!.headHandle, 8);
    assert.strictEqual(published!.tailHandle, 8);
  });
}
