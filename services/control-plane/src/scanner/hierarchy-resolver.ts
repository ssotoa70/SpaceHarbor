/**
 * VFX hierarchy resolver — given a parsed render path's codes, returns the
 * canonical (projectId, sequenceId, shotId). Auto-creates sequence and
 * shot rows when missing (idempotent at the code level — concurrent
 * resolves of the same codes may race, in which case the second writer
 * sees the first's row on retry).
 *
 * Project rows are NEVER auto-created — projects are an organizational
 * decision and must exist before render output is scanned. Returning a
 * HierarchyNotFoundError gives the caller a chance to surface it as a
 * configuration error rather than silently creating phantom projects.
 *
 * Pure-ish: no HTTP, only persistence calls. Tested against the local
 * in-memory adapter so behavior is verifiable without VAST.
 */

import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";
import type { ParsedRenderPath } from "./path-parser.js";

export class HierarchyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HierarchyNotFoundError";
  }
}

export interface ResolvedHierarchy {
  projectId: string;
  sequenceId: string;
  shotId: string;
  versionLabel: string;
}

export async function resolveHierarchy(
  parsed: ParsedRenderPath,
  persistence: PersistenceAdapter,
  ctx: WriteContext,
): Promise<ResolvedHierarchy> {
  // 1. Project must exist.
  const projects = await persistence.listProjects();
  const project = projects.find((p) => p.code === parsed.projectCode);
  if (!project) {
    throw new HierarchyNotFoundError(`Project not found: ${parsed.projectCode}`);
  }

  // 2. Resolve or create sequence (by project + code).
  // Auto-created sequences default to status=active. Frame range is left
  // unset because we only know it from individual versions, not from the
  // hierarchy slot itself.
  const sequences = await persistence.listSequencesByProject(project.id);
  let sequence = sequences.find((s) => s.code === parsed.sequenceCode);
  if (!sequence) {
    sequence = await persistence.createSequence(
      {
        projectId: project.id,
        code: parsed.sequenceCode,
        episode: parsed.episodeCode ?? undefined,
        status: "active",
      },
      ctx,
    );
  }

  // 3. Resolve or create shot (by sequence + code).
  // Frame counts default to 0; the actual range is captured later when
  // versions register their frame_range_start/end on ingest.
  const shots = await persistence.listShotsBySequence(sequence.id);
  let shot = shots.find((s) => s.code === parsed.shotCode);
  if (!shot) {
    shot = await persistence.createShot(
      {
        projectId: project.id,
        sequenceId: sequence.id,
        code: parsed.shotCode,
        status: "active",
        frameRangeStart: 0,
        frameRangeEnd: 0,
        frameCount: 0,
      },
      ctx,
    );
  }

  return {
    projectId: project.id,
    sequenceId: sequence.id,
    shotId: shot.id,
    versionLabel: parsed.versionLabel,
  };
}
