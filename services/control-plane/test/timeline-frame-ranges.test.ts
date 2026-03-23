import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

function createApp() {
  return buildApp();
}

test("accepts frame range fields on clip ingest", async () => {
  const app = createApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: {
      name: "SEQ010_edit",
      projectId: "proj-1",
      sourceUri: "s3://timelines/SEQ010.otio",
      frameRate: 24,
      durationFrames: 1200,
      tracks: [
        {
          name: "V1",
          clips: [
            {
              clip_name: "SH010",
              source_uri: "s3://renders/SH010.exr",
              in_frame: 0,
              out_frame: 120,
              duration_frames: 120,
              vfx_cut_in: 1001,
              vfx_cut_out: 1120,
              handle_head: 8,
              handle_tail: 8,
              delivery_in: 993,
              delivery_out: 1128,
              source_timecode: "01:00:00:00",
            },
          ],
        },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  await app.close();
});

test("returns frame range fields from GET /timelines/:id", async () => {
  const app = createApp();
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: {
      name: "SEQ010_edit",
      projectId: "proj-1",
      sourceUri: "s3://timelines/SEQ010.otio",
      tracks: [
        {
          name: "V1",
          clips: [
            {
              clip_name: "SH010",
              in_frame: 0,
              out_frame: 120,
              duration_frames: 120,
              vfx_cut_in: 1001,
              vfx_cut_out: 1120,
              handle_head: 8,
              handle_tail: 8,
              delivery_in: 993,
              delivery_out: 1128,
              source_timecode: "01:00:00:00",
            },
          ],
        },
      ],
    },
  });
  const timelineId = ingestRes.json().id;

  const getRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${timelineId}` });
  assert.equal(getRes.statusCode, 200);
  const body = getRes.json();
  assert.equal(body.clips.length, 1);
  const clip = body.clips[0];
  assert.equal(clip.vfxCutIn, 1001);
  assert.equal(clip.vfxCutOut, 1120);
  assert.equal(clip.handleHead, 8);
  assert.equal(clip.handleTail, 8);
  assert.equal(clip.deliveryIn, 993);
  assert.equal(clip.deliveryOut, 1128);
  assert.equal(clip.sourceTimecode, "01:00:00:00");
  await app.close();
});

test("returns frame range fields from GET /timelines/:id/clips", async () => {
  const app = createApp();
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: {
      name: "SEQ020_edit",
      projectId: "proj-1",
      sourceUri: "s3://timelines/SEQ020.otio",
      tracks: [
        {
          name: "V1",
          clips: [
            {
              clip_name: "SH020",
              in_frame: 0,
              out_frame: 96,
              duration_frames: 96,
              vfx_cut_in: 2001,
              vfx_cut_out: 2096,
              handle_head: 12,
              handle_tail: 12,
              delivery_in: 1989,
              delivery_out: 2108,
              source_timecode: "02:00:00:00",
            },
          ],
        },
      ],
    },
  });
  const timelineId = ingestRes.json().id;

  const clipsRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${timelineId}/clips` });
  assert.equal(clipsRes.statusCode, 200);
  const clips = clipsRes.json();
  assert.equal(clips[0].vfxCutIn, 2001);
  assert.equal(clips[0].handleHead, 12);
  assert.equal(clips[0].sourceTimecode, "02:00:00:00");
  await app.close();
});

test("defaults frame range fields to null when not provided", async () => {
  const app = createApp();
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: {
      name: "SEQ030_edit",
      projectId: "proj-1",
      sourceUri: "s3://timelines/SEQ030.otio",
      tracks: [
        {
          name: "V1",
          clips: [
            {
              clip_name: "SH030",
              in_frame: 0,
              out_frame: 48,
              duration_frames: 48,
            },
          ],
        },
      ],
    },
  });
  const timelineId = ingestRes.json().id;

  const getRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${timelineId}` });
  const clip = getRes.json().clips[0];
  assert.equal(clip.vfxCutIn, null);
  assert.equal(clip.vfxCutOut, null);
  assert.equal(clip.handleHead, null);
  assert.equal(clip.handleTail, null);
  assert.equal(clip.deliveryIn, null);
  assert.equal(clip.deliveryOut, null);
  assert.equal(clip.sourceTimecode, null);
  await app.close();
});

test("handles multiple clips with different frame ranges", async () => {
  const app = createApp();
  const ingestRes = await app.inject({
    method: "POST",
    url: "/api/v1/timelines/ingest",
    payload: {
      name: "SEQ040_edit",
      projectId: "proj-1",
      sourceUri: "s3://timelines/SEQ040.otio",
      tracks: [
        {
          name: "V1",
          clips: [
            {
              clip_name: "SH040",
              in_frame: 0,
              out_frame: 48,
              duration_frames: 48,
              vfx_cut_in: 1001,
              vfx_cut_out: 1048,
              handle_head: 8,
              handle_tail: 8,
              source_timecode: "01:00:00:00",
            },
            {
              clip_name: "SH050",
              in_frame: 48,
              out_frame: 120,
              duration_frames: 72,
              vfx_cut_in: 2001,
              vfx_cut_out: 2072,
              handle_head: 16,
              handle_tail: 16,
              source_timecode: "01:00:02:00",
            },
          ],
        },
      ],
    },
  });
  const timelineId = ingestRes.json().id;

  const clipsRes = await app.inject({ method: "GET", url: `/api/v1/timelines/${timelineId}/clips` });
  const clips = clipsRes.json();
  assert.equal(clips.length, 2);

  const sh040 = clips.find((c: any) => c.clipName === "SH040");
  const sh050 = clips.find((c: any) => c.clipName === "SH050");
  assert.equal(sh040.handleHead, 8);
  assert.equal(sh050.handleHead, 16);
  assert.equal(sh040.sourceTimecode, "01:00:00:00");
  assert.equal(sh050.sourceTimecode, "01:00:02:00");
  await app.close();
});
