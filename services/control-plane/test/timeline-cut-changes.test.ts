import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

const baseTimeline = {
  name: "SEQ010_edit_v1",
  projectId: "proj-1",
  sourceUri: "s3://renders/SEQ010_edit_v1.otio",
  frameRate: 24,
  durationFrames: 2400,
  tracks: [
    {
      name: "V1",
      kind: "Video",
      clips: [
        { clip_name: "SH010", source_uri: "s3://renders/SH010.exr", in_frame: 0, out_frame: 48, duration_frames: 48 },
        { clip_name: "SH020", source_uri: "s3://renders/SH020.exr", in_frame: 48, out_frame: 120, duration_frames: 72 },
        { clip_name: "SH030", source_uri: "s3://renders/SH030.exr", in_frame: 120, out_frame: 200, duration_frames: 80 },
      ],
    },
  ],
};

test("first ingest has no cut changes", async () => {
  const app = createApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: baseTimeline,
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.cutChanges, undefined);
  await app.close();
});

test("re-ingest with modified clip detects change", async () => {
  const app = createApp();
  await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });

  const modified = {
    ...baseTimeline,
    sourceUri: "s3://renders/SEQ010_edit_v2.otio",
    tracks: [
      {
        name: "V1",
        kind: "Video",
        clips: [
          { clip_name: "SH010", source_uri: "s3://renders/SH010.exr", in_frame: 0, out_frame: 48, duration_frames: 48 },
          { clip_name: "SH020", source_uri: "s3://renders/SH020.exr", in_frame: 48, out_frame: 130, duration_frames: 82 },
          { clip_name: "SH030", source_uri: "s3://renders/SH030.exr", in_frame: 130, out_frame: 210, duration_frames: 80 },
        ],
      },
    ],
  };

  const res = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: modified });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.cutChanges);
  assert.equal(body.cutChanges.length, 2);
  const sh020Change = body.cutChanges.find((c: any) => c.clipName === "SH020");
  assert.equal(sh020Change.changeType, "modified");
  assert.equal(sh020Change.previousOutFrame, 120);
  assert.equal(sh020Change.newOutFrame, 130);
  await app.close();
});

test("re-ingest with added clip detects addition", async () => {
  const app = createApp();
  await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });

  const withNewClip = {
    ...baseTimeline,
    sourceUri: "s3://renders/SEQ010_edit_v2.otio",
    tracks: [
      {
        name: "V1",
        kind: "Video",
        clips: [
          ...baseTimeline.tracks[0].clips,
          { clip_name: "SH040", source_uri: "s3://renders/SH040.exr", in_frame: 200, out_frame: 280, duration_frames: 80 },
        ],
      },
    ],
  };

  const res = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: withNewClip });
  const body = res.json();
  assert.ok(body.cutChanges);
  const added = body.cutChanges.find((c: any) => c.changeType === "added");
  assert.ok(added);
  assert.equal(added.clipName, "SH040");
  await app.close();
});

test("re-ingest with removed clip detects removal", async () => {
  const app = createApp();
  await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });

  const withoutSH030 = {
    ...baseTimeline,
    sourceUri: "s3://renders/SEQ010_edit_v2.otio",
    tracks: [
      {
        name: "V1",
        kind: "Video",
        clips: [
          { clip_name: "SH010", source_uri: "s3://renders/SH010.exr", in_frame: 0, out_frame: 48, duration_frames: 48 },
          { clip_name: "SH020", source_uri: "s3://renders/SH020.exr", in_frame: 48, out_frame: 120, duration_frames: 72 },
        ],
      },
    ],
  };

  const res = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: withoutSH030 });
  const body = res.json();
  assert.ok(body.cutChanges);
  const removed = body.cutChanges.find((c: any) => c.changeType === "removed");
  assert.ok(removed);
  assert.equal(removed.clipName, "SH030");
  await app.close();
});

test("GET /timelines/:id/changes returns change set", async () => {
  const app = createApp();
  await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });

  const modified = {
    ...baseTimeline,
    sourceUri: "s3://renders/SEQ010_edit_v2.otio",
    tracks: [
      {
        name: "V1",
        kind: "Video",
        clips: [
          { clip_name: "SH010", source_uri: "s3://renders/SH010.exr", in_frame: 0, out_frame: 48, duration_frames: 48 },
          { clip_name: "SH020", source_uri: "s3://renders/SH020.exr", in_frame: 48, out_frame: 130, duration_frames: 82 },
          { clip_name: "SH030", source_uri: "s3://renders/SH030.exr", in_frame: 130, out_frame: 210, duration_frames: 80 },
        ],
      },
    ],
  };

  const ingestRes = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: modified });
  const newTimelineId = ingestRes.json().id;

  const changesRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${newTimelineId}/changes` });
  assert.equal(changesRes.statusCode, 200);
  const body = changesRes.json();
  assert.equal(body.timelineId, newTimelineId);
  assert.ok(body.changes.length > 0);
  await app.close();
});

test("GET /timelines/:id/changes returns empty for first ingest", async () => {
  const app = createApp();
  const res = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });
  const timelineId = res.json().id;

  const changesRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${timelineId}/changes` });
  assert.equal(changesRes.statusCode, 200);
  assert.deepStrictEqual(changesRes.json().changes, []);
  await app.close();
});

test("GET /timelines/:id/changes returns 404 for unknown timeline", async () => {
  const app = createApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/timelines/nonexistent/changes" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("detects multiple change types simultaneously", async () => {
  const app = createApp();
  await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: baseTimeline });

  const complex = {
    ...baseTimeline,
    sourceUri: "s3://renders/SEQ010_edit_v2.otio",
    tracks: [
      {
        name: "V1",
        kind: "Video",
        clips: [
          { clip_name: "SH010", source_uri: "s3://renders/SH010.exr", in_frame: 0, out_frame: 48, duration_frames: 48 },
          { clip_name: "SH020", source_uri: "s3://renders/SH020.exr", in_frame: 48, out_frame: 140, duration_frames: 92 },
          { clip_name: "SH040", source_uri: "s3://renders/SH040.exr", in_frame: 140, out_frame: 220, duration_frames: 80 },
        ],
      },
    ],
  };

  const res = await app.inject({ method: "POST", url: "/api/v1/timelines/ingest", payload: complex });
  const body = res.json();
  assert.ok(body.cutChanges);

  const changeTypes = body.cutChanges.map((c: any) => c.changeType);
  assert.ok(changeTypes.includes("added"));
  assert.ok(changeTypes.includes("removed"));
  assert.ok(changeTypes.includes("modified"));
  await app.close();
});
