import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { TimelineChange, TimelineChangeSet } from "../domain/models.js";
import { errorEnvelopeSchema } from "../http/schemas.js";
import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";

function ctx(correlationId?: string): WriteContext {
  return { correlationId: correlationId ?? randomUUID() };
}

interface ClipSnapshot {
  clipName: string;
  sourceUri: string | null;
  inFrame: number;
  outFrame: number;
}

function diffClips(
  oldClips: ClipSnapshot[],
  newClips: ClipSnapshot[]
): TimelineChange[] {
  const changes: TimelineChange[] = [];
  const oldByName = new Map<string, ClipSnapshot>();
  for (const c of oldClips) oldByName.set(c.clipName, c);

  const newByName = new Map<string, ClipSnapshot>();
  for (const c of newClips) newByName.set(c.clipName, c);

  // Added clips (in new, not in old)
  for (const [name, clip] of newByName) {
    if (!oldByName.has(name)) {
      changes.push({
        clipName: name,
        sourceUri: clip.sourceUri,
        changeType: "added",
        newInFrame: clip.inFrame,
        newOutFrame: clip.outFrame,
      });
    }
  }

  // Removed clips (in old, not in new)
  for (const [name, clip] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        clipName: name,
        sourceUri: clip.sourceUri,
        changeType: "removed",
        previousInFrame: clip.inFrame,
        previousOutFrame: clip.outFrame,
      });
    }
  }

  // Modified clips (in both, but in/out frames changed)
  for (const [name, newClip] of newByName) {
    const oldClip = oldByName.get(name);
    if (oldClip && (oldClip.inFrame !== newClip.inFrame || oldClip.outFrame !== newClip.outFrame)) {
      changes.push({
        clipName: name,
        sourceUri: newClip.sourceUri,
        changeType: "modified",
        previousInFrame: oldClip.inFrame,
        previousOutFrame: oldClip.outFrame,
        newInFrame: newClip.inFrame,
        newOutFrame: newClip.outFrame,
      });
    }
  }

  return changes;
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
          additionalProperties: false,
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
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  kind: { type: "string" },
                  clips: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        clip_name: { type: "string" },
                        source_uri: { type: "string", nullable: true },
                        in_frame: { type: "number" },
                        out_frame: { type: "number" },
                        duration_frames: { type: "number" },
                        shot_name: { type: "string" },
                        vfx_cut_in: { type: "number" },
                        vfx_cut_out: { type: "number" },
                        handle_head: { type: "number" },
                        handle_tail: { type: "number" },
                        delivery_in: { type: "number" },
                        delivery_out: { type: "number" },
                        source_timecode: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          500: errorEnvelopeSchema
        },
      },
    },
    async (request, reply) => {
      const body = request.body as any;
      const writeCtx = ctx(request.headers["x-correlation-id"] as string);

      // Check for existing timeline with same projectId + name
      const existing = await persistence.findTimelineByProjectAndName(
        body.projectId,
        body.name
      );
      let oldClips: ClipSnapshot[] = [];
      if (existing) {
        const clips = await persistence.listClipsByTimeline(existing.id);
        oldClips = clips.map((c) => ({
          clipName: c.clipName,
          sourceUri: c.sourceUri,
          inFrame: c.inFrame,
          outFrame: c.outFrame,
        }));
      }

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
      const newClips: ClipSnapshot[] = [];
      for (const track of tracks) {
        for (const clip of track.clips ?? []) {
          const clipName = clip.clip_name ?? "unnamed";
          const sourceUri = clip.source_uri ?? null;
          const inFrame = clip.in_frame ?? 0;
          const outFrame = clip.out_frame ?? 0;
          await persistence.createTimelineClip(
            {
              timelineId: timeline.id,
              trackName: track.name ?? "V1",
              clipName,
              sourceUri,
              inFrame,
              outFrame,
              durationFrames: clip.duration_frames ?? 0,
              vfxCutIn: clip.vfx_cut_in,
              vfxCutOut: clip.vfx_cut_out,
              handleHead: clip.handle_head,
              handleTail: clip.handle_tail,
              deliveryIn: clip.delivery_in,
              deliveryOut: clip.delivery_out,
              sourceTimecode: clip.source_timecode,
            },
            writeCtx
          );
          newClips.push({ clipName, sourceUri, inFrame, outFrame });
        }
      }

      // Cut change detection: compare old and new clips
      let changes: TimelineChange[] | undefined;
      if (existing && oldClips.length > 0) {
        changes = diffClips(oldClips, newClips);
        if (changes.length > 0) {
          const changeSet: TimelineChangeSet = {
            id: randomUUID(),
            timelineId: timeline.id,
            previousTimelineId: existing.id,
            changes,
            createdAt: new Date().toISOString(),
          };
          await persistence.storeTimelineChanges(changeSet);

          // Emit timeline.cut_change event via outbox
          const outboxPayload: Record<string, unknown> = {
            type: "timeline.cut_change",
            timelineId: timeline.id,
            previousTimelineId: existing.id,
            projectId: body.projectId,
            name: body.name,
            changeCount: changes.length,
            affectedShots: changes.map((c) => c.clipName),
            changes,
          };
          // Use the outbox mechanism via persistence (appendAuditEntry style)
          // For now we emit via the Fastify app's event system (test-friendly)
          app.log.info(
            { eventType: "timeline.cut_change", timelineId: timeline.id },
            "Cut change detected"
          );
          // Publish to outbox if available
          if ("enqueueOutbox" in persistence) {
            (persistence as any).enqueueOutbox(
              "timeline.cut_change",
              writeCtx.correlationId,
              outboxPayload,
              new Date()
            );
          }
        }
      }

      return reply.status(201).send({
        ...timeline,
        ...(changes && changes.length > 0 ? { cutChanges: changes } : {}),
      });
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
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema
        },
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
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });
      return persistence.listClipsByTimeline(id);
    }
  );

  // GET /timelines/:id/changes — get cut changes vs previous version
  app.get(
    `${prefix}/timelines/:id/changes`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "getTimelineChanges",
        summary: "Get cut changes compared to previous timeline version",
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });

      const changeSet = await persistence.getTimelineChanges(id);
      if (!changeSet) {
        return { timelineId: id, changes: [], message: "No previous version to compare" };
      }
      return changeSet;
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
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          500: errorEnvelopeSchema
        },
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

  // POST /timelines/:id/reconform — manual reconform after hierarchy changes (Phase C.9)
  app.post(
    `${prefix}/timelines/:id/reconform`,
    {
      schema: {
        tags: ["timelines"],
        operationId: "reconformTimeline",
        summary: "Re-conform timeline clips against updated hierarchy",
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          500: errorEnvelopeSchema
        },
        description:
          "Triggers re-matching of all clips against the current shot hierarchy. " +
          "Use after hierarchy changes (shot renames, additions, deletions) to " +
          "update clip-to-shot associations without re-ingesting the timeline.",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const writeCtx = ctx(request.headers["x-correlation-id"] as string);

      const timeline = await persistence.getTimelineById(id);
      if (!timeline) return reply.status(404).send({ error: "Timeline not found" });

      // Snapshot current clip states for diff detection
      const clipsBefore = await persistence.listClipsByTimeline(id);
      const beforeSnapshot = clipsBefore.map(c => ({
        clipId: c.id,
        clipName: c.clipName,
        shotId: c.shotId,
        conformStatus: c.conformStatus,
      }));

      await persistence.updateTimelineStatus(id, "conforming", writeCtx);

      // Re-match each clip against the current hierarchy
      const clips = await persistence.listClipsByTimeline(id);
      let matchedCount = 0;
      let unmatchedCount = 0;
      let changedCount = 0;

      const allSequences = await persistence.listSequencesByProject(timeline.projectId);
      for (const clip of clips) {
        let matched = false;
        for (const seq of allSequences) {
          const seqShots = await persistence.listShotsBySequence(seq.id);
          for (const shot of seqShots) {
            if (clip.clipName.includes(shot.code) || (clip.sourceUri && clip.sourceUri.includes(shot.code))) {
              const wasMatched = clip.shotId === shot.id && clip.conformStatus === "matched";
              await persistence.updateClipConformStatus(clip.id, "matched", shot.id);
              if (!wasMatched) changedCount++;
              matched = true;
              matchedCount++;
              break;
            }
          }
          if (matched) break;
        }

        if (!matched) {
          const wasPreviouslyMatched = clip.conformStatus === "matched";
          await persistence.updateClipConformStatus(clip.id, "unmatched");
          if (wasPreviouslyMatched) changedCount++;
          unmatchedCount++;
        }
      }

      const updated = await persistence.updateTimelineStatus(id, "conformed", writeCtx);
      const updatedClips = await persistence.listClipsByTimeline(id);

      return reply.send({
        ...updated,
        reconformResult: {
          totalClips: clips.length,
          matched: matchedCount,
          unmatched: unmatchedCount,
          changed: changedCount,
        },
        clips: updatedClips,
      });
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
        response: {
          200: { type: "object", additionalProperties: true },
          401: errorEnvelopeSchema
        },
      },
    },
    async (request) => {
      const { projectId } = request.query as { projectId: string };
      return persistence.listTimelinesByProject(projectId);
    }
  );
}
