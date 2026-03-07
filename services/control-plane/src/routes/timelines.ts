import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";

function ctx(correlationId?: string): WriteContext {
  return { correlationId: correlationId ?? randomUUID() };
}

export async function registerTimelinesRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter
): Promise<void> {
  const prefix = "/api/v1";

  // POST /timelines/ingest — create timeline from OTIO file reference
  app.post(
    `${prefix}/timelines/ingest`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "ingestTimeline",
        summary: "Ingest an OTIO timeline file",
        body: {
          type: "object",
          required: ["name", "projectId", "sourceUri"],
          properties: {
            name: { type: "string" },
            projectId: { type: "string" },
            sourceUri: { type: "string" },
            frameRate: { type: "number" },
            durationFrames: { type: "number" },
            tracks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  kind: { type: "string" },
                  clips: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        clip_name: { type: "string" },
                        source_uri: { type: "string", nullable: true },
                        in_frame: { type: "number" },
                        out_frame: { type: "number" },
                        duration_frames: { type: "number" },
                        shot_name: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as any;
      const writeCtx = ctx(request.headers["x-correlation-id"] as string);

      const timeline = await persistence.createTimeline(
        {
          name: body.name,
          projectId: body.projectId,
          frameRate: body.frameRate ?? 24.0,
          durationFrames: body.durationFrames ?? 0,
          sourceUri: body.sourceUri,
        },
        writeCtx
      );

      // If tracks/clips data is provided (from OTIO parser), create clips
      const tracks = body.tracks ?? [];
      for (const track of tracks) {
        for (const clip of track.clips ?? []) {
          await persistence.createTimelineClip(
            {
              timelineId: timeline.id,
              trackName: track.name ?? "V1",
              clipName: clip.clip_name ?? "unnamed",
              sourceUri: clip.source_uri ?? null,
              inFrame: clip.in_frame ?? 0,
              outFrame: clip.out_frame ?? 0,
              durationFrames: clip.duration_frames ?? 0,
            },
            writeCtx
          );
        }
      }

      return reply.status(201).send(timeline);
    }
  );

  // GET /timelines/:id — get timeline details
  app.get(
    `${prefix}/timelines/:id`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "getTimeline",
        summary: "Get a timeline by ID",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });

      const clips = await persistence.listClipsByTimeline(id);
      return { ...timeline, clips };
    }
  );

  // GET /timelines/:id/clips — list clips
  app.get(
    `${prefix}/timelines/:id/clips`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "listTimelineClips",
        summary: "List clips in a timeline",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });
      return persistence.listClipsByTimeline(id);
    }
  );

  // POST /timelines/:id/conform — trigger conforming
  app.post(
    `${prefix}/timelines/:id/conform`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "conformTimeline",
        summary: "Conform timeline clips to existing shots/versions",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const writeCtx = ctx(request.headers["x-correlation-id"] as string);

      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });

      await persistence.updateTimelineStatus(id, "conforming", writeCtx);

      const clips = await persistence.listClipsByTimeline(id);

      // Try to match each clip to existing shots in the project
      for (const clip of clips) {
        const shots = await persistence.listShotsBySequence("");
        // Try matching by clip name containing shot code
        let matched = false;
        const allSequences = await persistence.listSequencesByProject(timeline.projectId);
        for (const seq of allSequences) {
          const seqShots = await persistence.listShotsBySequence(seq.id);
          for (const shot of seqShots) {
            if (clip.clipName.includes(shot.code) || (clip.sourceUri && clip.sourceUri.includes(shot.code))) {
              await persistence.updateClipConformStatus(clip.id, "matched", shot.id);
              matched = true;
              break;
            }
          }
          if (matched) break;
        }

        if (!matched) {
          await persistence.updateClipConformStatus(clip.id, "unmatched");
        }
      }

      const updated = await persistence.updateTimelineStatus(id, "conformed", writeCtx);
      const updatedClips = await persistence.listClipsByTimeline(id);
      return { ...updated, clips: updatedClips };
    }
  );

  // GET /timelines?projectId= — list timelines for project
  app.get(
    `${prefix}/timelines`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "listTimelines",
        summary: "List timelines for a project",
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { projectId } = request.query as { projectId: string };
      return persistence.listTimelinesByProject(projectId);
    }
  );
}
