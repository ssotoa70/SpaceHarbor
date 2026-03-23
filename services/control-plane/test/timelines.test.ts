/**
 * Timeline / OTIO Routes Tests
 *
 * Tests ingest, clip listing, conforming, and status transitions.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

const API = "/api/v1";

test("Timeline routes: ingest creates timeline with clips", async () => {
  const app = buildApp();
  const persistence = (app as any).persistence;

  const project = await persistence.createProject(
    { code: "OTIO_PROJ", name: "OTIO Test", type: "feature", status: "active" },
    { correlationId: "test" }
  );

  const res = await app.inject({
    method: "POST",
    url: `${API}/timelines/ingest`,
    payload: {
      name: "Edit_v3",
      projectId: project.id,
      sourceUri: "/editorial/edit_v3.otio",
      frameRate: 24.0,
      durationFrames: 330,
      tracks: [
        {
          name: "V1",
          kind: "Video",
          clips: [
            { clip_name: "SH010_comp_v001", source_uri: "/media/sh010.exr", in_frame: 1001, out_frame: 1100, duration_frames: 100 },
            { clip_name: "SH020_comp_v001", source_uri: "/media/sh020.exr", in_frame: 1001, out_frame: 1150, duration_frames: 150 },
            { clip_name: "SH030_comp_v001", source_uri: "/media/sh030.exr", in_frame: 1001, out_frame: 1080, duration_frames: 80 },
          ],
        },
      ],
    },
  });

  assert.equal(res.statusCode, 201);
  const timeline = res.json();
  assert.equal(timeline.name, "Edit_v3");
  assert.equal(timeline.status, "ingested");
  assert.ok(timeline.id);

  // Verify clips were created
  const clipsRes = await app.inject({
    method: "GET",
    url: `${API}/timelines/${timeline.id}/clips`,
  });
  assert.equal(clipsRes.statusCode, 200);
  const clips = clipsRes.json();
  assert.equal(clips.length, 3);
  assert.equal(clips[0].clipName, "SH010_comp_v001");
  assert.equal(clips[0].conformStatus, "pending");

  await app.close();
});

test("Timeline routes: get timeline includes clips", async () => {
  const app = buildApp();
  const persistence = (app as any).persistence;

  const project = await persistence.createProject(
    { code: "GET_TL", name: "Get TL Test", type: "feature", status: "active" },
    { correlationId: "test" }
  );

  const ingestRes = await app.inject({
    method: "POST",
    url: `${API}/timelines/ingest`,
    payload: {
      name: "Test_TL",
      projectId: project.id,
      sourceUri: "/test.otio",
      tracks: [{ name: "V1", kind: "Video", clips: [{ clip_name: "clip1", in_frame: 0, out_frame: 50, duration_frames: 50 }] }],
    },
  });
  const timeline = ingestRes.json();

  const getRes = await app.inject({
    method: "GET",
    url: `${API}/timelines/${timeline.id}`,
  });
  assert.equal(getRes.statusCode, 200);
  const body = getRes.json();
  assert.ok(Array.isArray(body.clips));
  assert.equal(body.clips.length, 1);

  await app.close();
});

test("Timeline routes: conform matches clips to existing shots", async () => {
  const app = buildApp();
  const persistence = (app as any).persistence;

  const project = await persistence.createProject(
    { code: "CONFORM", name: "Conform Test", type: "feature", status: "active" },
    { correlationId: "test" }
  );
  const seq = await persistence.createSequence(
    { projectId: project.id, code: "SEQ010", status: "active" },
    { correlationId: "test" }
  );
  const shot = await persistence.createShot(
    { projectId: project.id, sequenceId: seq.id, code: "SH010", status: "active", frameRangeStart: 1001, frameRangeEnd: 1100, frameCount: 100 },
    { correlationId: "test" }
  );

  // Ingest timeline with clip that contains shot code
  const ingestRes = await app.inject({
    method: "POST",
    url: `${API}/timelines/ingest`,
    payload: {
      name: "ConformTest",
      projectId: project.id,
      sourceUri: "/test.otio",
      tracks: [
        {
          name: "V1",
          kind: "Video",
          clips: [
            { clip_name: "SH010_comp_v001", source_uri: "/media/sh010.exr", in_frame: 1001, out_frame: 1100, duration_frames: 100 },
            { clip_name: "UNKNOWN_shot", source_uri: "/media/unknown.exr", in_frame: 0, out_frame: 50, duration_frames: 50 },
          ],
        },
      ],
    },
  });
  const timeline = ingestRes.json();

  // Conform
  const conformRes = await app.inject({
    method: "POST",
    url: `${API}/timelines/${timeline.id}/conform`,
  });
  assert.equal(conformRes.statusCode, 200);
  const result = conformRes.json();
  assert.equal(result.status, "conformed");

  // Check clips
  const clips = result.clips;
  const matchedClip = clips.find((c: any) => c.clipName === "SH010_comp_v001");
  const unmatchedClip = clips.find((c: any) => c.clipName === "UNKNOWN_shot");
  assert.equal(matchedClip.conformStatus, "matched");
  assert.equal(matchedClip.shotId, shot.id);
  assert.equal(unmatchedClip.conformStatus, "unmatched");

  await app.close();
});

test("Timeline routes: list timelines by project", async () => {
  const app = buildApp();
  const persistence = (app as any).persistence;

  const project = await persistence.createProject(
    { code: "LIST_TL", name: "List TL Test", type: "feature", status: "active" },
    { correlationId: "test" }
  );

  await app.inject({
    method: "POST",
    url: `${API}/timelines/ingest`,
    payload: { name: "TL1", projectId: project.id, sourceUri: "/tl1.otio" },
  });
  await app.inject({
    method: "POST",
    url: `${API}/timelines/ingest`,
    payload: { name: "TL2", projectId: project.id, sourceUri: "/tl2.otio" },
  });

  const res = await app.inject({
    method: "GET",
    url: `${API}/timelines?projectId=${project.id}`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().length, 2);

  await app.close();
});

test("Timeline routes: 404 on missing timeline", async () => {
  const app = buildApp();

  const res = await app.inject({ method: "GET", url: `${API}/timelines/nonexistent` });
  assert.equal(res.statusCode, 404);

  await app.close();
});
