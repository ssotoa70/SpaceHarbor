import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import {
  HierarchyNotFoundError,
  resolveHierarchy,
} from "../src/scanner/hierarchy-resolver.js";
import type { ParsedRenderPath } from "../src/scanner/path-parser.js";

const ctx = { correlationId: "test-corr" };

function makeParsed(over: Partial<ParsedRenderPath> = {}): ParsedRenderPath {
  return {
    projectCode: "PROJ_NOVA",
    episodeCode: null,
    sequenceCode: "SEQ_010",
    shotCode: "SH040",
    versionLabel: "v001",
    filename: "beauty.0001.exr",
    extension: ".exr",
    isSentinel: false,
    ...over,
  };
}

describe("resolveHierarchy", () => {
  let p: LocalPersistenceAdapter;
  beforeEach(() => {
    p = new LocalPersistenceAdapter();
  });

  it("throws HierarchyNotFoundError when project does not exist", async () => {
    await assert.rejects(
      () => resolveHierarchy(makeParsed(), p, ctx),
      HierarchyNotFoundError,
    );
  });

  it("auto-creates sequence and shot when project exists", async () => {
    const project = await p.createProject(
      { code: "PROJ_NOVA", name: "Project Nova", type: "feature", status: "active" },
      ctx,
    );

    const r = await resolveHierarchy(makeParsed(), p, ctx);
    assert.equal(r.projectId, project.id);
    assert.ok(r.sequenceId);
    assert.ok(r.shotId);
    assert.equal(r.versionLabel, "v001");

    // Verify the sequence + shot actually landed in persistence.
    const sequences = await p.listSequencesByProject(project.id);
    assert.equal(sequences.length, 1);
    assert.equal(sequences[0].code, "SEQ_010");
    const shots = await p.listShotsBySequence(sequences[0].id);
    assert.equal(shots.length, 1);
    assert.equal(shots[0].code, "SH040");
  });

  it("reuses existing sequence + shot on second resolve (idempotent)", async () => {
    const project = await p.createProject(
      { code: "PROJ_NOVA", name: "Project Nova", type: "feature", status: "active" },
      ctx,
    );
    const first = await resolveHierarchy(makeParsed(), p, ctx);
    const second = await resolveHierarchy(makeParsed(), p, ctx);

    assert.equal(first.sequenceId, second.sequenceId, "sequence reused");
    assert.equal(first.shotId, second.shotId, "shot reused");
    assert.equal(first.projectId, project.id);

    // Only one sequence + one shot row should exist.
    assert.equal((await p.listSequencesByProject(project.id)).length, 1);
    assert.equal((await p.listShotsBySequence(first.sequenceId)).length, 1);
  });

  it("creates a separate sequence when sequenceCode differs", async () => {
    const project = await p.createProject(
      { code: "PROJ_NOVA", name: "Project Nova", type: "feature", status: "active" },
      ctx,
    );
    await resolveHierarchy(makeParsed({ sequenceCode: "SEQ_010" }), p, ctx);
    await resolveHierarchy(makeParsed({ sequenceCode: "SEQ_020" }), p, ctx);
    const sequences = await p.listSequencesByProject(project.id);
    assert.equal(sequences.length, 2);
  });

  it("propagates episode code when present", async () => {
    const project = await p.createProject(
      { code: "SHOW1", name: "Show One", type: "episodic", status: "active" },
      ctx,
    );
    await resolveHierarchy(
      makeParsed({ projectCode: "SHOW1", episodeCode: "EP02", sequenceCode: "SEQ_500" }),
      p,
      ctx,
    );
    const sequences = await p.listSequencesByProject(project.id);
    assert.equal(sequences.length, 1);
    assert.equal(sequences[0].episode, "EP02");
  });

  it("creates separate shots within the same sequence when shotCode differs", async () => {
    const project = await p.createProject(
      { code: "PROJ_NOVA", name: "Project Nova", type: "feature", status: "active" },
      ctx,
    );
    const r1 = await resolveHierarchy(makeParsed({ shotCode: "SH040" }), p, ctx);
    const r2 = await resolveHierarchy(makeParsed({ shotCode: "SH041" }), p, ctx);
    assert.equal(r1.sequenceId, r2.sequenceId);
    assert.notEqual(r1.shotId, r2.shotId);
    const shots = await p.listShotsBySequence(r1.sequenceId);
    assert.equal(shots.length, 2);
  });
});
