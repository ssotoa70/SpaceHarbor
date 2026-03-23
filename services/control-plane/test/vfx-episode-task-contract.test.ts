/**
 * VFX Episode + Task Contract Tests (SERGIO-136)
 *
 * Tests the full hierarchy: Project → Episode → Sequence → Shot → Task → Version
 * Runs against LocalPersistenceAdapter.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { ReferentialIntegrityError } from "../src/persistence/types.js";
import type { VfxHierarchyAdapter } from "../src/persistence/types.js";

const CTX = { correlationId: "test-correlation-id" };

function makeAdapters(): Array<{ name: string; adapter: VfxHierarchyAdapter }> {
  return [{ name: "LocalAdapter", adapter: new LocalPersistenceAdapter() }];
}

// ---------------------------------------------------------------------------
// Test 1: createEpisode with valid projectId returns Episode with UUID
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createEpisode with valid projectId returns Episode with UUID`, async () => {
    const project = await adapter.createProject(
      { code: "EP_PROJ_01", name: "Episode Project", type: "episodic", status: "active" },
      CTX
    );

    const episode = await adapter.createEpisode(
      { projectId: project.id, code: "EP01", name: "The Beginning", status: "active" },
      CTX
    );

    assert.ok(episode.id, "episode.id should be set");
    assert.match(
      episode.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "episode.id should be a UUID"
    );
    assert.equal(episode.projectId, project.id);
    assert.equal(episode.code, "EP01");
    assert.equal(episode.name, "The Beginning");
    assert.equal(episode.status, "active");
    assert.equal(episode.sequenceCount, 0);
    assert.ok(episode.createdAt);
    assert.ok(episode.updatedAt);
  });
}

// ---------------------------------------------------------------------------
// Test 2: createEpisode with non-existent projectId throws ReferentialIntegrityError
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createEpisode with non-existent projectId throws ReferentialIntegrityError`, async () => {
    await assert.rejects(
      () =>
        adapter.createEpisode(
          { projectId: "00000000-0000-0000-0000-000000000000", code: "EP99", status: "active" },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 3: listEpisodesByProject returns only episodes for that project
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] listEpisodesByProject returns only episodes for that project`, async () => {
    const projA = await adapter.createProject(
      { code: "EP_LIST_A", name: "List A", type: "episodic", status: "active" },
      CTX
    );
    const projB = await adapter.createProject(
      { code: "EP_LIST_B", name: "List B", type: "episodic", status: "active" },
      CTX
    );

    await adapter.createEpisode({ projectId: projA.id, code: "EP01", status: "active" }, CTX);
    await adapter.createEpisode({ projectId: projA.id, code: "EP02", status: "active" }, CTX);
    await adapter.createEpisode({ projectId: projB.id, code: "EP01", status: "active" }, CTX);

    const episodesA = await adapter.listEpisodesByProject(projA.id);
    const episodesB = await adapter.listEpisodesByProject(projB.id);

    assert.equal(episodesA.length, 2);
    assert.equal(episodesB.length, 1);
    assert.ok(episodesA.every((e) => e.projectId === projA.id));
  });
}

// ---------------------------------------------------------------------------
// Test 4: createSequence with valid episodeId sets episodeId on sequence
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createSequence with valid episodeId sets episodeId on sequence`, async () => {
    const project = await adapter.createProject(
      { code: "EP_SEQ_01", name: "Episode Seq Project", type: "episodic", status: "active" },
      CTX
    );
    const episode = await adapter.createEpisode(
      { projectId: project.id, code: "EP01", status: "active" },
      CTX
    );

    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_EP010", status: "active", episodeId: episode.id },
      CTX
    );

    assert.ok(seq.id);
    assert.equal(seq.episodeId, episode.id);
    assert.equal(seq.projectId, project.id);
  });
}

// ---------------------------------------------------------------------------
// Test 5: createTask with valid shotId returns Task with taskNumber = 1
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createTask with valid shotId returns Task with taskNumber = 1`, async () => {
    const project = await adapter.createProject(
      { code: "TASK_PROJ_01", name: "Task Project", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_T010", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_T010",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const task = await adapter.createTask(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        code: "COMP",
        type: "comp",
        status: "not_started"
      },
      CTX
    );

    assert.ok(task.id);
    assert.match(
      task.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "task.id should be a UUID"
    );
    assert.equal(task.shotId, shot.id);
    assert.equal(task.projectId, project.id);
    assert.equal(task.sequenceId, seq.id);
    assert.equal(task.code, "COMP");
    assert.equal(task.type, "comp");
    assert.equal(task.status, "not_started");
    assert.equal(task.taskNumber, 1);
    assert.ok(task.createdAt);
    assert.ok(task.updatedAt);
  });
}

// ---------------------------------------------------------------------------
// Test 6: createTask with non-existent shotId throws ReferentialIntegrityError
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createTask with non-existent shotId throws ReferentialIntegrityError`, async () => {
    const project = await adapter.createProject(
      { code: "TASK_REF_ERR", name: "Ref Err Project", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_REF_ERR", status: "active" },
      CTX
    );

    await assert.rejects(
      () =>
        adapter.createTask(
          {
            shotId: "00000000-0000-0000-0000-000000000000",
            projectId: project.id,
            sequenceId: seq.id,
            code: "COMP",
            type: "comp",
            status: "not_started"
          },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 7: second createTask on same shot gets taskNumber = 2
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] second createTask on same shot gets taskNumber = 2`, async () => {
    const project = await adapter.createProject(
      { code: "TASK_MONO_01", name: "Mono Project", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_MONO", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_MONO",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const taskBase = {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: seq.id,
      type: "comp" as const,
      status: "not_started" as const
    };

    await adapter.createTask({ ...taskBase, code: "COMP" }, CTX);
    const task2 = await adapter.createTask({ ...taskBase, code: "FX_01" }, CTX);

    assert.equal(task2.taskNumber, 2);
    assert.equal(task2.code, "FX_01");
  });
}

// ---------------------------------------------------------------------------
// Test 8: listTasksByShot returns tasks for that shot only, ordered by taskNumber
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] listTasksByShot returns tasks for that shot only, ordered by taskNumber`, async () => {
    const project = await adapter.createProject(
      { code: "TASK_LIST_01", name: "List Project", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_TLIST", status: "active" },
      CTX
    );
    const shotA = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_TA",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );
    const shotB = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_TB",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );

    const baseA = { shotId: shotA.id, projectId: project.id, sequenceId: seq.id, type: "comp" as const, status: "not_started" as const };
    const baseB = { shotId: shotB.id, projectId: project.id, sequenceId: seq.id, type: "fx" as const, status: "not_started" as const };

    await adapter.createTask({ ...baseA, code: "COMP" }, CTX);
    await adapter.createTask({ ...baseA, code: "FX_01" }, CTX);
    await adapter.createTask({ ...baseB, code: "FX_01" }, CTX);

    const tasksA = await adapter.listTasksByShot(shotA.id);
    const tasksB = await adapter.listTasksByShot(shotB.id);

    assert.equal(tasksA.length, 2);
    assert.equal(tasksB.length, 1);
    assert.equal(tasksA[0].taskNumber, 1);
    assert.equal(tasksA[1].taskNumber, 2);
    assert.ok(tasksA.every((t) => t.shotId === shotA.id));
  });
}

// ---------------------------------------------------------------------------
// Test 9: createVersion with optional taskId sets taskId on version
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersion with optional taskId sets taskId on version`, async () => {
    const project = await adapter.createProject(
      { code: "VER_TASK_01", name: "Ver Task Project", type: "feature", status: "active" },
      CTX
    );
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_VT01", status: "active" },
      CTX
    );
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_VT01",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1048,
        frameCount: 48
      },
      CTX
    );
    const task = await adapter.createTask(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        code: "COMP",
        type: "comp",
        status: "not_started"
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
        createdBy: "artist@studio.com",
        taskId: task.id
      },
      CTX
    );

    assert.ok(version.id);
    assert.equal(version.taskId, task.id);
  });
}

// ---------------------------------------------------------------------------
// Test 10: Full hierarchy traversal — project → episode → sequence → shot → task → version
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] full hierarchy traversal: project → episode → sequence → shot → task → version`, async () => {
    // Project
    const project = await adapter.createProject(
      { code: "FULL_EP_TRAVERSE", name: "Full Episode Traversal", type: "episodic", status: "active" },
      CTX
    );
    assert.ok(project.id);

    // Episode
    const episode = await adapter.createEpisode(
      { projectId: project.id, code: "EP01", name: "Pilot", status: "active" },
      CTX
    );
    assert.equal(episode.projectId, project.id);

    // Sequence linked to episode
    const seq = await adapter.createSequence(
      { projectId: project.id, code: "SEQ_EP110", status: "active", episodeId: episode.id },
      CTX
    );
    assert.equal(seq.episodeId, episode.id);

    // Shot
    const shot = await adapter.createShot(
      {
        projectId: project.id,
        sequenceId: seq.id,
        code: "SH_EP110",
        status: "active",
        frameRangeStart: 1001,
        frameRangeEnd: 1200,
        frameCount: 200
      },
      CTX
    );
    assert.equal(shot.sequenceId, seq.id);

    // Task
    const task = await adapter.createTask(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        code: "COMP",
        type: "comp",
        status: "not_started"
      },
      CTX
    );
    assert.equal(task.taskNumber, 1);

    // Version linked to task
    const version = await adapter.createVersion(
      {
        shotId: shot.id,
        projectId: project.id,
        sequenceId: seq.id,
        versionLabel: "v001",
        status: "draft",
        mediaType: "exr_sequence",
        createdBy: "artist@studio.com",
        taskId: task.id
      },
      CTX
    );
    assert.equal(version.taskId, task.id);
    assert.equal(version.versionNumber, 1);

    // Full list verification
    const episodes = await adapter.listEpisodesByProject(project.id);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].code, "EP01");

    const tasks = await adapter.listTasksByShot(shot.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].code, "COMP");
  });
}
