import { describe, expect, it } from "vitest";

import {
  DATAENGINE_FUNCTIONS_BY_KIND,
  dataEngineFunctionsForFilename,
  metadataKindForFilename,
} from "./metadata-routing";

describe("metadataKindForFilename", () => {
  it("classifies images, videos, and unknown files", () => {
    expect(metadataKindForFilename("shot.0042.exr")).toBe("image");
    expect(metadataKindForFilename("A001C003.mov")).toBe("video");
    expect(metadataKindForFilename("notes.pdf")).toBe("none");
    expect(metadataKindForFilename("README")).toBe("none");
  });

  it("is case-insensitive on extensions", () => {
    expect(metadataKindForFilename("SHOT.EXR")).toBe("image");
    expect(metadataKindForFilename("clip.MOV")).toBe("video");
  });
});

describe("DATAENGINE_FUNCTIONS_BY_KIND", () => {
  it("maps image to oiio-proxy-generator + frame-metadata-extractor in that order", () => {
    const funcs = DATAENGINE_FUNCTIONS_BY_KIND.image;
    expect(funcs.map((f) => f.name)).toEqual([
      "oiio-proxy-generator",
      "frame-metadata-extractor",
    ]);
  });

  it("maps video to video-proxy-generator + video-metadata-extractor in that order", () => {
    const funcs = DATAENGINE_FUNCTIONS_BY_KIND.video;
    expect(funcs.map((f) => f.name)).toEqual([
      "video-proxy-generator",
      "video-metadata-extractor",
    ]);
  });

  it("maps none to an empty list", () => {
    expect(DATAENGINE_FUNCTIONS_BY_KIND.none).toEqual([]);
  });

  it("reports the VastDB schema for metadata-writing functions", () => {
    expect(DATAENGINE_FUNCTIONS_BY_KIND.image.find((f) => f.name === "frame-metadata-extractor")?.tableSchema).toBe("frame_metadata");
    expect(DATAENGINE_FUNCTIONS_BY_KIND.video.find((f) => f.name === "video-metadata-extractor")?.tableSchema).toBe("video_metadata");
  });

  it("reports null tableSchema for proxy-only functions (S3 artifacts, no DB write)", () => {
    expect(DATAENGINE_FUNCTIONS_BY_KIND.image.find((f) => f.name === "oiio-proxy-generator")?.tableSchema).toBeNull();
    expect(DATAENGINE_FUNCTIONS_BY_KIND.video.find((f) => f.name === "video-proxy-generator")?.tableSchema).toBeNull();
  });
});

describe("dataEngineFunctionsForFilename", () => {
  it("returns the image pipeline for an EXR", () => {
    const names = dataEngineFunctionsForFilename("shot.0042.exr").map((f) => f.name);
    expect(names).toContain("oiio-proxy-generator");
    expect(names).toContain("frame-metadata-extractor");
  });

  it("returns the video pipeline for an MOV", () => {
    const names = dataEngineFunctionsForFilename("A001C003.mov").map((f) => f.name);
    expect(names).toContain("video-proxy-generator");
    expect(names).toContain("video-metadata-extractor");
  });

  it("returns an empty list for unsupported extensions", () => {
    expect(dataEngineFunctionsForFilename("notes.pdf")).toEqual([]);
  });
});
