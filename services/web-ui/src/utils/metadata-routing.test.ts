import { describe, expect, it } from "vitest";

import {
  metadataKindForFilename,
  classifyForPipelines,
  METADATA_IMAGE_EXTS,
  METADATA_VIDEO_EXTS,
} from "./metadata-routing";
import type { DiscoveredPipeline } from "../api";

describe("metadataKindForFilename", () => {
  it("classifies image extensions as image", () => {
    expect(metadataKindForFilename("shot.0042.exr")).toBe("image");
    expect(metadataKindForFilename("frame.dpx")).toBe("image");
    expect(metadataKindForFilename("still.tiff")).toBe("image");
  });

  it("classifies video extensions as video (including raw camera)", () => {
    expect(metadataKindForFilename("A001C003.mov")).toBe("video");
    expect(metadataKindForFilename("clip.mp4")).toBe("video");
    expect(metadataKindForFilename("take01.r3d")).toBe("video");
    expect(metadataKindForFilename("take02.braw")).toBe("video");
  });

  it("returns none for unknown extensions", () => {
    expect(metadataKindForFilename("notes.pdf")).toBe("none");
    expect(metadataKindForFilename("index.html")).toBe("none");
  });

  it("returns none for files without an extension", () => {
    expect(metadataKindForFilename("README")).toBe("none");
    expect(metadataKindForFilename("")).toBe("none");
  });

  it("is case-insensitive", () => {
    expect(metadataKindForFilename("SHOT.EXR")).toBe("image");
    expect(metadataKindForFilename("clip.MOV")).toBe("video");
  });
});

// Build a realistic three-pipeline config matching the production default.
function makePipelines(): DiscoveredPipeline[] {
  return [
    {
      config: {
        fileKind: "image",
        functionName: "frame-metadata-extractor",
        extensions: [".exr", ".dpx", ".tif", ".tiff", ".png", ".jpg", ".jpeg"],
        targetSchema: "frame_metadata",
        targetTable: "files",
        sidecarSchemaId: "frame@1",
        displayLabel: "Images",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "video",
        functionName: "video-metadata-extractor",
        extensions: [".mp4", ".mov", ".mxf", ".avi", ".mkv", ".m4v", ".webm"],
        targetSchema: "video_metadata",
        targetTable: "files",
        sidecarSchemaId: "video@1",
        displayLabel: "Video",
      },
      live: null,
      status: "ok",
    },
    {
      config: {
        fileKind: "raw_camera",
        functionName: "raw-camera-metadata-extractor",
        extensions: [".r3d", ".braw"],
        targetSchema: "raw_camera_metadata",
        targetTable: "files",
        sidecarSchemaId: "raw@1",
        displayLabel: "Raw Camera",
      },
      live: null,
      status: "ok",
    },
  ];
}

describe("metadataKindForFilename (existing static-set path)", () => {
  // Back-compat invariant — these must continue to pass unchanged.
  it("classifies EXR as image", () => {
    expect(metadataKindForFilename("shot_001.exr")).toBe("image");
  });
  it("classifies MOV as video", () => {
    expect(metadataKindForFilename("take_03.mov")).toBe("video");
  });
  it("classifies R3D as video (legacy — static set folds raw into video)", () => {
    // Existing behavior: static-set path returns "video" for R3D/BRAW
    // because they share the video-metadata-extractor. classifyForPipelines
    // can distinguish raw_camera when a pipeline exists; the sync path
    // cannot.
    expect(metadataKindForFilename("A001_C001.r3d")).toBe("video");
  });
  it("returns none for unknown extension", () => {
    expect(metadataKindForFilename("readme.md")).toBe("none");
  });
  it("returns none for filename without extension", () => {
    expect(metadataKindForFilename("no-extension")).toBe("none");
  });
});

describe("classifyForPipelines (new pipeline-aware path)", () => {
  it("classifies EXR via image pipeline", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("shot_001.exr", pipelines);
    expect(result.kind).toBe("image");
    expect(result.pipeline?.config.fileKind).toBe("image");
    expect(result.pipeline?.config.functionName).toBe("frame-metadata-extractor");
  });

  it("classifies MOV via video pipeline", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("take_03.mov", pipelines);
    expect(result.kind).toBe("video");
    expect(result.pipeline?.config.fileKind).toBe("video");
  });

  it("classifies R3D via raw_camera pipeline (distinct from video)", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("A001_C001.r3d", pipelines);
    expect(result.kind).toBe("raw_camera");
    expect(result.pipeline?.config.fileKind).toBe("raw_camera");
  });

  it("returns none + null pipeline for unknown extension", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("readme.md", pipelines);
    expect(result.kind).toBe("none");
    expect(result.pipeline).toBeNull();
  });

  it("falls through to static sets when pipelines is null", () => {
    // Used by useStorageSidecar's on-mount eligibility gate, before
    // the pipelines fetch has resolved.
    const result = classifyForPipelines("shot.exr", null);
    expect(result.kind).toBe("image");
    expect(result.pipeline).toBeNull();
  });

  it("falls through to static sets and returns 'video' for R3D when pipelines is null", () => {
    // Back-compat: when the async pipelines list is unavailable, R3D
    // maps to 'video' (same as the static-set path).
    const result = classifyForPipelines("A001.r3d", null);
    expect(result.kind).toBe("video");
    expect(result.pipeline).toBeNull();
  });

  it("returns none for every filename when pipelines is empty array", () => {
    // Empty config — seed hasn't been run. No pipeline matches, so
    // everything is 'none'. Caller renders "No pipeline configured".
    expect(classifyForPipelines("shot.exr", [])).toEqual({ kind: "none", pipeline: null });
    expect(classifyForPipelines("clip.mov", [])).toEqual({ kind: "none", pipeline: null });
  });

  it("matches case-insensitively on extension", () => {
    const pipelines = makePipelines();
    const result = classifyForPipelines("SHOT.EXR", pipelines);
    expect(result.kind).toBe("image");
  });

  it("returns first match when multiple pipelines contain the same extension", () => {
    // Defensive — the validator prevents this at write time, but if
    // somehow two pipelines both claim .exr, we return the first.
    const pipelines: DiscoveredPipeline[] = [
      {
        config: {
          fileKind: "image",
          functionName: "a",
          extensions: [".exr"],
          targetSchema: "a",
          targetTable: "a",
          sidecarSchemaId: "a",
        },
        live: null,
        status: "ok",
      },
      {
        config: {
          fileKind: "video",
          functionName: "b",
          extensions: [".exr"],
          targetSchema: "b",
          targetTable: "b",
          sidecarSchemaId: "b",
        },
        live: null,
        status: "ok",
      },
    ];
    const result = classifyForPipelines("shot.exr", pipelines);
    expect(result.pipeline?.config.functionName).toBe("a");
  });

  it("returns disabled pipelines too (classification, not routing decision)", () => {
    // A disabled pipeline still classifies the file — callers decide
    // what to do with a disabled pipeline.
    const pipelines: DiscoveredPipeline[] = [
      {
        config: {
          fileKind: "image",
          functionName: "a",
          extensions: [".exr"],
          targetSchema: "a",
          targetTable: "a",
          sidecarSchemaId: "a",
        },
        live: null,
        status: "function-not-found",
      },
    ];
    const result = classifyForPipelines("shot.exr", pipelines);
    expect(result.kind).toBe("image");
    expect(result.pipeline).toBe(pipelines[0]);
  });
});

describe("METADATA_IMAGE_EXTS + METADATA_VIDEO_EXTS (static sets — unchanged)", () => {
  // Guard test — the static sets exist for the null-pipelines fallback
  // path and for useStorageSidecar's eligibility gate. Their contents
  // should not change in this cycle.
  it("static image set contains .exr", () => {
    expect(METADATA_IMAGE_EXTS.has(".exr")).toBe(true);
  });
  it("static video set contains .mov and raw camera formats", () => {
    expect(METADATA_VIDEO_EXTS.has(".mov")).toBe(true);
    expect(METADATA_VIDEO_EXTS.has(".r3d")).toBe(true);
    expect(METADATA_VIDEO_EXTS.has(".braw")).toBe(true);
  });
});
