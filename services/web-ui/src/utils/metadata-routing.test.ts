import { describe, expect, it } from "vitest";

import { metadataKindForFilename } from "./metadata-routing";

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
