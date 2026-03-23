import type { WorkflowStatus, TimelineClip, TimelineChange } from "../domain/models.js";
import { parseVfxMetadata } from "../domain/vfx-metadata-parser.js";
import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";
import { canTransitionWorkflowStatus } from "../workflow/transitions.js";
import type { NormalizedAssetEvent, NormalizedVastEvent, ProxyGeneratedEvent } from "./types.js";

/**
 * Compute the diff between old and new timeline clips.
 * Returns a list of changes: added, removed, or modified clips.
 */
function computeTimelineDiff(
  oldClips: TimelineClip[],
  newClips: Array<{ clipName: string; sourceUri: string | null; inFrame: number; outFrame: number }>,
): TimelineChange[] {
  const changes: TimelineChange[] = [];

  const oldMap = new Map(oldClips.map(c => [c.clipName, c]));
  const newMap = new Map(newClips.map(c => [c.clipName, c]));

  // Detect removed clips
  for (const [name, oldClip] of oldMap) {
    if (!newMap.has(name)) {
      changes.push({
        clipName: name,
        sourceUri: oldClip.sourceUri,
        changeType: "removed",
        previousInFrame: oldClip.inFrame,
        previousOutFrame: oldClip.outFrame,
      });
    }
  }

  // Detect added and modified clips
  for (const [name, newClip] of newMap) {
    const oldClip = oldMap.get(name);
    if (!oldClip) {
      changes.push({
        clipName: name,
        sourceUri: newClip.sourceUri,
        changeType: "added",
        newInFrame: newClip.inFrame,
        newOutFrame: newClip.outFrame,
      });
    } else if (oldClip.inFrame !== newClip.inFrame || oldClip.outFrame !== newClip.outFrame) {
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

export async function processProxyGeneratedEvent(
  event: ProxyGeneratedEvent,
  persistence: PersistenceAdapter,
  context: WriteContext,
): Promise<void> {
  const asset = await persistence.getAssetById(event.asset_id);
  if (!asset) return;

  await persistence.updateAsset(
    event.asset_id,
    {
      metadata: {
        ...(asset.metadata ?? {}),
        thumbnail_url: event.thumbnail_uri,
        proxy_url: event.proxy_uri,
      },
    },
    context,
  );
}

function isReviewContractEvent(eventType: NormalizedAssetEvent["eventType"]): boolean {
  return (
    eventType === "asset.review.annotation_created" ||
    eventType === "asset.review.annotation_resolved" ||
    eventType === "asset.review.task_linked" ||
    eventType === "asset.review.submission_created" ||
    eventType === "asset.review.decision_recorded" ||
    eventType === "asset.review.decision_overridden"
  );
}

function mapEventToStatus(eventType: NormalizedAssetEvent["eventType"]): WorkflowStatus {
  switch (eventType) {
    case "asset.processing.started":
      return "processing";
    case "asset.processing.completed":
      return "completed";
    case "asset.processing.failed":
      return "failed";
    case "asset.processing.replay_requested":
      return "needs_replay";
    case "asset.review.qc_pending":
      return "qc_pending";
    case "asset.review.in_review":
      return "qc_in_review";
    case "asset.review.approved":
      return "qc_approved";
    case "asset.review.rejected":
      return "qc_rejected";
    default:
      return "pending";
  }
}

export async function processAssetEvent(
  persistence: PersistenceAdapter,
  event: NormalizedAssetEvent,
  context: WriteContext,
  options?: {
    enableRetryOnFailure?: boolean;
  }
): Promise<{
  accepted: boolean;
  duplicate: boolean;
  reason?: "NOT_FOUND" | "WORKFLOW_TRANSITION_NOT_ALLOWED";
  status?: WorkflowStatus;
  movedToDlq?: boolean;
  retryScheduled?: boolean;
  message?: string;
}> {
  // Atomic idempotency gate: check-and-mark in a single operation to
  // close the TOCTOU race window (CWE-367 / M13). The previous pattern
  // of hasProcessedEvent() → markProcessedEvent() allowed a concurrent
  // instance to pass the check before either had marked the event.
  const isNew = await persistence.markIfNotProcessed(event.eventId);
  if (!isNew) {
    return {
      accepted: true,
      duplicate: true
    };
  }

  if (event.eventType === "asset.processing.failed") {
    const existing = await persistence.getJobById(event.jobId);
    if (!existing) {
      return {
        accepted: false,
        duplicate: false,
        reason: "NOT_FOUND",
        message: `job not found: ${event.jobId}`
      };
    }

    if (!canTransitionWorkflowStatus(existing.status, "failed")) {
      return {
        accepted: false,
        duplicate: false,
        reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
        message: `transition not allowed: ${existing.status} -> failed`
      };
    }

    if (!options?.enableRetryOnFailure) {
      const updated = await persistence.setJobStatus(event.jobId, "failed", event.error ?? null, context);
      if (!updated) {
        return {
          accepted: false,
          duplicate: false,
          reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
          message: `transition not allowed: ${existing.status} -> failed`
        };
      }

      return {
        accepted: true,
        duplicate: false,
        status: "failed"
      };
    }

    const failedResult = await persistence.handleJobFailure(event.jobId, event.error ?? "unknown processing error", context);
    if (!failedResult.accepted) {
      return {
        accepted: false,
        duplicate: false,
        reason: "NOT_FOUND",
        message: failedResult.message ?? `job not found: ${event.jobId}`
      };
    }

    return {
      accepted: true,
      duplicate: false,
      status: failedResult.status,
      movedToDlq: failedResult.movedToDlq,
      retryScheduled: failedResult.retryScheduled
    };
  }

  if (isReviewContractEvent(event.eventType)) {
    const existing = await persistence.getJobById(event.jobId);
    if (!existing) {
      return {
        accepted: false,
        duplicate: false,
        reason: "NOT_FOUND",
        message: `job not found: ${event.jobId}`
      };
    }

    return {
      accepted: true,
      duplicate: false,
      status: existing.status
    };
  }

  const status = mapEventToStatus(event.eventType);

  const existing = await persistence.getJobById(event.jobId);
  if (!existing) {
    return {
      accepted: false,
      duplicate: false,
      reason: "NOT_FOUND",
      message: `job not found: ${event.jobId}`
    };
  }

  if (!canTransitionWorkflowStatus(existing.status, status)) {
    return {
      accepted: false,
      duplicate: false,
      reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
      message: `transition not allowed: ${existing.status} -> ${status}`
    };
  }

  const updated = await persistence.setJobStatus(event.jobId, status, event.error ?? null, context);
  if (!updated) {
    return {
      accepted: false,
      duplicate: false,
      reason: "WORKFLOW_TRANSITION_NOT_ALLOWED",
      message: `transition not allowed: ${existing.status} -> ${status}`
    };
  }

  return {
    accepted: true,
    duplicate: false,
    status
  };
}

/**
 * Process a VAST DataEngine function completion event.
 * Routes metadata updates to the appropriate asset fields based on function_id.
 */
export async function processVastFunctionCompletion(
  persistence: PersistenceAdapter,
  event: NormalizedVastEvent,
  functionId: string,
  context: WriteContext,
): Promise<{ accepted: boolean; functionId: string; action: string }> {
  // Atomic idempotency gate (CWE-367 / M13 fix) — same pattern as processAssetEvent.
  const isNew = await persistence.markIfNotProcessed(event.eventId);
  if (!isNew) {
    return { accepted: true, functionId, action: "duplicate" };
  }

  const metadata = event.metadata ?? {};

  switch (functionId) {
    case "exr_inspector": {
      // Update asset VFX metadata with EXR inspection results (strongly typed)
      const assetId = typeof metadata.asset_id === "string" ? metadata.asset_id : "";
      const asset = await persistence.getAssetById(assetId);
      if (asset) {
        const parsed = parseVfxMetadata(metadata);
        await persistence.updateAsset(
          asset.id,
          { metadata: { ...(asset.metadata ?? {}), ...parsed } },
          context,
        );
        // Also update the linked Version's technical metadata (codec, resolution,
        // frame range, color space, compression, bit depth, channels, etc.)
        if (asset.currentVersionId) {
          await persistence.updateVersionTechnicalMetadata(
            asset.currentVersionId,
            parsed,
            context,
          );

          // Phase C: Create provenance record when EXR metadata contains creator/render info
          const prov = metadata.provenance as Record<string, unknown> | undefined;
          if (prov && typeof prov === "object") {
            const softwareUsed = typeof prov.dcc === "string" ? prov.dcc : undefined;
            const softwareVersion = typeof prov.dcc_version === "string" ? prov.dcc_version : undefined;
            const renderJobId = typeof prov.render_job_id === "string" ? prov.render_job_id : undefined;
            const renderEngine = typeof prov.render_engine === "string" ? prov.render_engine : undefined;
            const renderFarmNode = typeof prov.render_farm_node === "string" ? prov.render_farm_node : undefined;
            const vastStoragePath = typeof metadata.vast_storage_path === "string" ? metadata.vast_storage_path : undefined;

            if (softwareUsed || renderJobId) {
              await persistence.createProvenance({
                versionId: asset.currentVersionId,
                creator: softwareUsed ?? undefined,
                softwareUsed,
                softwareVersion,
                renderJobId,
                pipelineStage: renderEngine ?? undefined,
                vastStoragePath,
                sourceHost: renderFarmNode,
              }, context);
            }
          }
        }
      }
      return { accepted: true, functionId, action: "metadata_updated" };
    }

    case "mtlx_parser": {
      // MaterialX parse results — create Material + MaterialVersion + LookVariant + MaterialDependency records
      const projectId = typeof metadata.project_id === "string" ? metadata.project_id : null;
      const materialName = typeof metadata.material_name === "string" ? metadata.material_name : null;
      if (projectId && materialName) {
        const material = await persistence.createMaterial({
          projectId,
          name: materialName,
          description: typeof metadata.description === "string" ? metadata.description : undefined,
          status: "active" as import("../domain/models.js").MaterialStatus,
          createdBy: typeof metadata.created_by === "string" ? metadata.created_by : "dataengine",
        }, context);

        const version = await persistence.createMaterialVersion({
          materialId: material.id,
          versionLabel: typeof metadata.version_label === "string" ? metadata.version_label : "v1",
          status: "published" as import("../domain/models.js").VersionStatus,
          sourcePath: typeof metadata.source_path === "string" ? metadata.source_path : "",
          contentHash: typeof metadata.content_hash === "string" ? metadata.content_hash : "",
          createdBy: typeof metadata.created_by === "string" ? metadata.created_by : "dataengine",
          mtlxSpecVersion: typeof metadata.mtlx_spec_version === "string" ? metadata.mtlx_spec_version : undefined,
          usdMaterialPath: typeof metadata.usd_material_path === "string" ? metadata.usd_material_path : undefined,
          renderContexts: Array.isArray(metadata.render_contexts) ? metadata.render_contexts as string[] : undefined,
          lookNames: Array.isArray(metadata.look_names) ? metadata.look_names as string[] : undefined,
        }, context);

        // Create look variants if provided
        const looks = Array.isArray(metadata.looks) ? metadata.looks as Record<string, unknown>[] : [];
        for (const look of looks) {
          if (typeof look.name === "string") {
            await persistence.createLookVariant({
              materialVersionId: version.id,
              lookName: look.name,
              description: typeof look.description === "string" ? look.description : undefined,
              materialAssigns: typeof look.material_assigns === "string" ? look.material_assigns : undefined,
            }, context);
          }
        }

        // Create material dependencies (textures) if provided
        const textures = Array.isArray(metadata.textures) ? metadata.textures as Record<string, unknown>[] : [];
        for (const tex of textures) {
          if (typeof tex.path === "string") {
            await persistence.createMaterialDependency({
              materialVersionId: version.id,
              texturePath: tex.path,
              contentHash: typeof tex.content_hash === "string" ? tex.content_hash : "",
              textureType: typeof tex.texture_type === "string" ? tex.texture_type as import("../domain/models.js").TextureType : undefined,
              colorspace: typeof tex.colorspace === "string" ? tex.colorspace : undefined,
              dependencyDepth: typeof tex.depth === "number" ? tex.depth : 0,
            }, context);

            // Phase C.6: Also create cross-entity dependency graph record
            await persistence.createDependency({
              sourceEntityType: "material_version",
              sourceEntityId: version.id,
              targetEntityType: "texture",
              targetEntityId: tex.path,
              dependencyType: "references_texture",
              dependencyStrength: "hard",
              discoveredBy: "mtlx-parser",
            }, context);
          }
        }

        // Phase C.6: Detect texture content hash changes if this is an update
        // to an existing material (same source path, different content hash)
        const existingVersion = await persistence.findMaterialVersionBySourcePathAndHash(
          typeof metadata.source_path === "string" ? metadata.source_path : "",
          typeof metadata.content_hash === "string" ? metadata.content_hash : "",
        );
        if (!existingVersion && typeof metadata.source_path === "string" && metadata.source_path) {
          // New content hash for known source path — texture change detected
          // Emit asset.dependency.changed SSE event via the outbox pattern
        }
      }
      return { accepted: true, functionId, action: "mtlx_parsed" };
    }

    case "otio_parser": {
      // OTIO timeline parse results — create Timeline + TimelineClip records
      // Phase C.9: OTIO ingestion pipeline with diff detection
      const projectId = typeof metadata.project_id === "string" ? metadata.project_id : null;
      const timelineName = typeof metadata.timeline_name === "string" ? metadata.timeline_name : null;
      if (projectId && timelineName) {
        // C.9: Check if timeline with same projectId + name already exists (diff detection)
        const existingTimeline = await persistence.findTimelineByProjectAndName(projectId, timelineName);

        const timeline = await persistence.createTimeline({
          name: timelineName,
          projectId,
          frameRate: typeof metadata.frame_rate === "number" ? metadata.frame_rate : 24,
          durationFrames: typeof metadata.duration_frames === "number" ? metadata.duration_frames : 0,
          sourceUri: typeof metadata.source_uri === "string" ? metadata.source_uri : "",
        }, context);

        // Collect new clips for diff comparison
        const newClipEntries: Array<{ clipName: string; sourceUri: string | null; inFrame: number; outFrame: number }> = [];

        // Create clips per parsed track/clip
        const tracks = Array.isArray(metadata.tracks) ? metadata.tracks as Record<string, unknown>[] : [];
        for (const track of tracks) {
          const trackName = typeof track.name === "string" ? track.name : "V1";
          const clips = Array.isArray(track.clips) ? track.clips as Record<string, unknown>[] : [];
          for (const clip of clips) {
            const clipName = typeof clip.clip_name === "string" ? clip.clip_name : (typeof clip.name === "string" ? clip.name : "");
            const sourceUri = typeof clip.source_uri === "string" ? clip.source_uri : null;
            const inFrame = typeof clip.in_frame === "number" ? clip.in_frame : 0;
            const outFrame = typeof clip.out_frame === "number" ? clip.out_frame : 0;

            await persistence.createTimelineClip({
              timelineId: timeline.id,
              trackName,
              clipName,
              sourceUri,
              inFrame,
              outFrame,
              durationFrames: typeof clip.duration_frames === "number" ? clip.duration_frames : 0,
              shotName: typeof clip.shot_name === "string" ? clip.shot_name : undefined,
              vfxCutIn: typeof clip.vfx_cut_in === "number" ? clip.vfx_cut_in : undefined,
              vfxCutOut: typeof clip.vfx_cut_out === "number" ? clip.vfx_cut_out : undefined,
              handleHead: typeof clip.handle_head === "number" ? clip.handle_head : undefined,
              handleTail: typeof clip.handle_tail === "number" ? clip.handle_tail : undefined,
              deliveryIn: typeof clip.delivery_in === "number" ? clip.delivery_in : undefined,
              deliveryOut: typeof clip.delivery_out === "number" ? clip.delivery_out : undefined,
              sourceTimecode: typeof clip.source_timecode === "string" ? clip.source_timecode : undefined,
            }, context);

            newClipEntries.push({ clipName, sourceUri, inFrame, outFrame });
          }
        }

        // C.9: OTIO diff detection — compute and store TimelineChangeSet
        if (existingTimeline) {
          const oldClips = await persistence.listClipsByTimeline(existingTimeline.id);
          const changes = computeTimelineDiff(oldClips, newClipEntries);
          if (changes.length > 0) {
            await persistence.storeTimelineChanges({
              id: crypto.randomUUID(),
              timelineId: timeline.id,
              previousTimelineId: existingTimeline.id,
              changes,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
      return { accepted: true, functionId, action: "otio_parsed" };
    }

    case "oiio_proxy_generator": {
      // Proxy generation — update version's thumbnail_url and proxy_url
      const assetId = typeof metadata.asset_id === "string" ? metadata.asset_id : "";
      const thumbnailUri = typeof metadata.thumbnail_uri === "string" ? metadata.thumbnail_uri : undefined;
      const proxyUri = typeof metadata.proxy_uri === "string" ? metadata.proxy_uri : undefined;
      const asset = await persistence.getAssetById(assetId);
      if (asset) {
        // Update asset metadata with proxy URLs
        await persistence.updateAsset(
          asset.id,
          {
            metadata: {
              ...(asset.metadata ?? {}),
              ...(thumbnailUri ? { thumbnail_url: thumbnailUri } : {}),
              ...(proxyUri ? { proxy_url: proxyUri } : {}),
            },
          },
          context,
        );
        // Also update the linked Version's media URLs via companion table
        if (asset.currentVersionId && (thumbnailUri || proxyUri)) {
          await persistence.updateVersionTechnicalMetadata(
            asset.currentVersionId,
            {
              ...(thumbnailUri ? { thumbnail_url: thumbnailUri } : {}),
              ...(proxyUri ? { proxy_url: proxyUri } : {}),
            },
            context,
          );
        }
      }
      return { accepted: true, functionId, action: "proxy_generated" };
    }

    case "scanner": {
      // Scanner — already handled by ingest route
      return { accepted: true, functionId, action: "scan_completed" };
    }

    default: {
      return { accepted: true, functionId, action: "unknown_function" };
    }
  }
}
