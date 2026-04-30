import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AssetBadges,
  computeQcBadge,
  computeStructuralBadges,
} from "./AssetBadges";
import type { AssetMetadataResponse } from "../api";
import type { AssetRow } from "../types";

const baseAsset: AssetRow = {
  id: "a1",
  jobId: null,
  title: "test.exr",
  sourceUri: "s3://bucket/test.exr",
  status: "pending",
};

const baseMetadata = (over: Partial<AssetMetadataResponse> = {}): AssetMetadataResponse => ({
  assetId: "a1",
  sourceUri: "s3://bucket/test.exr",
  fileKind: "image",
  pipeline: { functionName: "frame-metadata-extractor", targetSchema: "frame_metadata", targetTable: "files", sidecarSchemaId: "frame@1" },
  sources: { db: "ok", sidecar: "missing" },
  dbRows: [{ file_id: "abc" }],
  sidecar: null,
  ...over,
});

afterEach(cleanup);

describe("computeStructuralBadges", () => {
  it("returns empty array when metadata is null", () => {
    expect(computeStructuralBadges(null)).toEqual([]);
  });

  it("DEEP badge when any part is_deep=true", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [{ part_index: 0, is_deep: true, width: 100, height: 100 }] },
    });
    const badges = computeStructuralBadges(meta);
    expect(badges.find((b) => b.id === "deep")).toBeDefined();
  });

  it("MULTIPART badge when parts.length > 1, with count in label", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [
        { part_index: 0, width: 100, height: 100 },
        { part_index: 1, width: 100, height: 100 },
        { part_index: 2, width: 100, height: 100 },
      ] },
    });
    const badges = computeStructuralBadges(meta);
    const mp = badges.find((b) => b.id === "multipart");
    expect(mp).toBeDefined();
    expect(mp?.label).toBe("Multipart (3 parts)");
  });

  it("STEREO badge with view names when multi_view=true", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [
        { part_index: 0, multi_view: true, view_name: "left" },
        { part_index: 1, multi_view: true, view_name: "right" },
      ] },
    });
    const badges = computeStructuralBadges(meta);
    const stereo = badges.find((b) => b.id === "stereo");
    expect(stereo).toBeDefined();
    expect(stereo?.label).toContain("left");
    expect(stereo?.label).toContain("right");
  });

  it("ANAMORPHIC badge when pixel_aspect_ratio differs from 1.0", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [{ part_index: 0, pixel_aspect_ratio: 2.0 }] },
    });
    const badges = computeStructuralBadges(meta);
    const anamorphic = badges.find((b) => b.id === "anamorphic");
    expect(anamorphic).toBeDefined();
    expect(anamorphic?.label).toContain("2");
  });

  it("ANAMORPHIC badge hidden for square pixels (par=1.0)", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [{ part_index: 0, pixel_aspect_ratio: 1.0 }] },
    });
    const badges = computeStructuralBadges(meta);
    expect(badges.find((b) => b.id === "anamorphic")).toBeUndefined();
  });

  it("BROADCAST badge when sidecar.metadata.container_format is MXF", () => {
    const meta = baseMetadata({
      sidecar: { metadata: { container_format: "MXF" } },
    });
    const badges = computeStructuralBadges(meta);
    expect(badges.find((b) => b.id === "broadcast")).toBeDefined();
  });

  it("BROADCAST badge NOT shown for MPEG-4", () => {
    const meta = baseMetadata({
      sidecar: { metadata: { container_format: "MPEG-4" } },
    });
    const badges = computeStructuralBadges(meta);
    expect(badges.find((b) => b.id === "broadcast")).toBeUndefined();
  });

  it("multiple badges combine deterministically", () => {
    const meta = baseMetadata({
      dbExtras: {
        parts: [
          { part_index: 0, is_deep: true, multi_view: true, view_name: "left", pixel_aspect_ratio: 2.0 },
          { part_index: 1, is_deep: false, multi_view: true, view_name: "right" },
        ],
      },
    });
    const badges = computeStructuralBadges(meta);
    const ids = badges.map((b) => b.id);
    expect(ids).toContain("deep");
    expect(ids).toContain("stereo");
    expect(ids).toContain("multipart");
    expect(ids).toContain("anamorphic");
  });
});

describe("computeQcBadge", () => {
  it("null when asset.qcStatus is absent (never default-show 'Pending')", () => {
    expect(computeQcBadge(baseAsset)).toBeNull();
  });

  it("approved → success tone", () => {
    const b = computeQcBadge({ ...baseAsset, qcStatus: "approved" } as AssetRow & { qcStatus: string });
    expect(b?.label).toBe("QC Approved");
    expect(b?.tone).toBe("success");
  });

  it("flagged → warning tone", () => {
    const b = computeQcBadge({ ...baseAsset, qcStatus: "flagged" } as AssetRow & { qcStatus: string });
    expect(b?.tone).toBe("warning");
  });

  it("failed → danger tone", () => {
    const b = computeQcBadge({ ...baseAsset, qcStatus: "failed" } as AssetRow & { qcStatus: string });
    expect(b?.tone).toBe("danger");
  });

  it("case-insensitive — uppercase APPROVED also resolves", () => {
    const b = computeQcBadge({ ...baseAsset, qcStatus: "APPROVED" } as AssetRow & { qcStatus: string });
    expect(b?.id).toBe("qc-approved");
  });
});

describe("<AssetBadges /> rendering", () => {
  it("renders nothing (and no testid) when no badges apply", () => {
    render(<AssetBadges asset={baseAsset} metadata={baseMetadata()} />);
    expect(screen.queryByTestId("asset-badges")).toBeNull();
  });

  it("renders structural badges in a row", () => {
    const meta = baseMetadata({
      dbExtras: { parts: [
        { part_index: 0, is_deep: true },
        { part_index: 1 },
      ] },
    });
    render(<AssetBadges asset={baseAsset} metadata={meta} />);
    expect(screen.getByTestId("asset-badges")).toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
    expect(screen.getByText(/Multipart \(2 parts\)/)).toBeInTheDocument();
  });

  it("renders QC badge when qcStatus is set", () => {
    const meta = baseMetadata();
    const asset = { ...baseAsset, qcStatus: "approved" } as AssetRow & { qcStatus: string };
    render(<AssetBadges asset={asset} metadata={meta} />);
    expect(screen.getByText("QC Approved")).toBeInTheDocument();
  });
});
