import test from "node:test";
import assert from "node:assert/strict";

import { createPersistenceAdapter } from "../src/persistence/factory.js";

test("extended asset model: VFX metadata fields are preserved through create and update", async () => {
  const adapter = createPersistenceAdapter("local");

  const { asset } = await adapter.createIngestAsset(
    { title: "shot_010_comp_v001.exr", sourceUri: "s3://renders/shot_010_comp_v001.exr" },
    { correlationId: "test-vfx-meta" }
  );

  // Asset starts without extended fields
  const initial = await adapter.getAssetById(asset.id);
  assert.ok(initial, "Asset should exist after creation");
  assert.equal(initial.metadata, undefined, "No metadata on fresh asset");

  // Update with all 8 VFX metadata fields
  const vfxMetadata = {
    codec: "OpenEXR",
    resolution: { width: 4096, height: 2160 },
    frame_range: { start: 1001, end: 1120 },
    frame_rate: 24,
    pixel_aspect_ratio: 1.0,
    display_window: { x: 0, y: 0, width: 4096, height: 2160 },
    data_window: { x: 0, y: 0, width: 4096, height: 2160 },
    compression_type: "zip",
    channels: ["R", "G", "B", "A", "Z"],
    color_space: "ACES",
    bit_depth: 16,
    file_size_bytes: 52428800,
    md5_checksum: "d41d8cd98f00b204e9800998ecf8427e"
  };

  const updated = await adapter.updateAsset(
    asset.id,
    { metadata: vfxMetadata },
    { correlationId: "test-vfx-meta-update" }
  );

  assert.ok(updated, "updateAsset should return the updated asset");
  assert.ok(updated.updatedAt, "updatedAt should be set");
  assert.deepEqual(updated.metadata?.codec, "OpenEXR");
  assert.deepEqual(updated.metadata?.resolution, { width: 4096, height: 2160 });
  assert.deepEqual(updated.metadata?.frame_range, { start: 1001, end: 1120 });
  assert.equal(updated.metadata?.frame_rate, 24);
  assert.equal(updated.metadata?.pixel_aspect_ratio, 1.0);
  assert.deepEqual(updated.metadata?.display_window, { x: 0, y: 0, width: 4096, height: 2160 });
  assert.deepEqual(updated.metadata?.data_window, { x: 0, y: 0, width: 4096, height: 2160 });
  assert.equal(updated.metadata?.compression_type, "zip");
  assert.deepEqual(updated.metadata?.channels, ["R", "G", "B", "A", "Z"]);
  assert.equal(updated.metadata?.color_space, "ACES");
  assert.equal(updated.metadata?.bit_depth, 16);
  assert.equal(updated.metadata?.file_size_bytes, 52428800);
  assert.equal(updated.metadata?.md5_checksum, "d41d8cd98f00b204e9800998ecf8427e");
});

test("extended asset model: version tracking with parent chain", async () => {
  const adapter = createPersistenceAdapter("local");

  // Create v001
  const { asset: assetV1 } = await adapter.createIngestAsset(
    { title: "shot_010_comp_v001.exr", sourceUri: "s3://renders/shot_010_comp_v001.exr" },
    { correlationId: "test-version-v1" }
  );

  await adapter.updateAsset(
    assetV1.id,
    { version: { version_label: "v001" } },
    { correlationId: "test-version-v1-set" }
  );

  // Create v002 linked to v001
  const { asset: assetV2 } = await adapter.createIngestAsset(
    { title: "shot_010_comp_v002.exr", sourceUri: "s3://renders/shot_010_comp_v002.exr" },
    { correlationId: "test-version-v2" }
  );

  await adapter.updateAsset(
    assetV2.id,
    { version: { version_label: "v002", parent_version_id: assetV1.id } },
    { correlationId: "test-version-v2-set" }
  );

  const v1 = await adapter.getAssetById(assetV1.id);
  const v2 = await adapter.getAssetById(assetV2.id);

  assert.ok(v1?.version, "v1 should have version info");
  assert.equal(v1.version.version_label, "v001");
  assert.equal(v1.version.parent_version_id, undefined, "v001 has no parent");

  assert.ok(v2?.version, "v2 should have version info");
  assert.equal(v2.version.version_label, "v002");
  assert.equal(v2.version.parent_version_id, assetV1.id, "v002 should link to v001");
});

test("extended asset model: integrity tracking (checksum + verified_at)", async () => {
  const adapter = createPersistenceAdapter("local");

  const { asset } = await adapter.createIngestAsset(
    { title: "plate_001.exr", sourceUri: "s3://renders/plate_001.exr" },
    { correlationId: "test-integrity" }
  );

  const integrity = {
    file_size_bytes: 104857600,
    checksum: { type: "md5" as const, value: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
    verified_at: "2026-03-03T12:00:00.000Z"
  };

  const updated = await adapter.updateAsset(
    asset.id,
    { integrity },
    { correlationId: "test-integrity-set" }
  );

  assert.ok(updated, "Updated asset should be returned");
  assert.ok(updated.integrity, "Integrity should be set");
  assert.equal(updated.integrity.file_size_bytes, 104857600);
  assert.equal(updated.integrity.checksum.type, "md5");
  assert.equal(updated.integrity.checksum.value, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  assert.equal(updated.integrity.verified_at, "2026-03-03T12:00:00.000Z");
});

test("extended asset model: metadata update preserves version and integrity", async () => {
  const adapter = createPersistenceAdapter("local");

  const { asset } = await adapter.createIngestAsset(
    { title: "comp_v003.exr", sourceUri: "s3://renders/comp_v003.exr" },
    { correlationId: "test-preserve" }
  );

  // Set version and integrity first
  await adapter.updateAsset(
    asset.id,
    {
      version: { version_label: "v003" },
      integrity: {
        file_size_bytes: 50000000,
        checksum: { type: "xxhash", value: "abc123" },
        verified_at: "2026-03-03T10:00:00.000Z"
      }
    },
    { correlationId: "test-preserve-initial" }
  );

  // Now update only metadata
  await adapter.updateAsset(
    asset.id,
    { metadata: { codec: "OpenEXR", bit_depth: 32 } },
    { correlationId: "test-preserve-meta" }
  );

  const final = await adapter.getAssetById(asset.id);
  assert.ok(final, "Asset should exist");
  assert.equal(final.metadata?.codec, "OpenEXR");
  assert.equal(final.metadata?.bit_depth, 32);
  assert.equal(final.version?.version_label, "v003", "Version should be preserved");
  assert.equal(final.integrity?.checksum.value, "abc123", "Integrity should be preserved");
});

test("extended asset model: metadata merges (partial update does not clobber)", async () => {
  const adapter = createPersistenceAdapter("local");

  const { asset } = await adapter.createIngestAsset(
    { title: "comp.exr", sourceUri: "s3://renders/comp.exr" },
    { correlationId: "test-merge" }
  );

  // First update: set codec and resolution
  await adapter.updateAsset(
    asset.id,
    { metadata: { codec: "OpenEXR", resolution: { width: 4096, height: 2160 } } },
    { correlationId: "test-merge-1" }
  );

  // Second update: set frame_rate only - codec and resolution should remain
  await adapter.updateAsset(
    asset.id,
    { metadata: { frame_rate: 24 } },
    { correlationId: "test-merge-2" }
  );

  const final = await adapter.getAssetById(asset.id);
  assert.ok(final?.metadata, "Metadata should exist");
  assert.equal(final.metadata.codec, "OpenEXR", "Codec should be preserved from first update");
  assert.deepEqual(final.metadata.resolution, { width: 4096, height: 2160 }, "Resolution should be preserved");
  assert.equal(final.metadata.frame_rate, 24, "Frame rate should be set from second update");
});

test("extended asset model: updateAsset returns null for non-existent asset", async () => {
  const adapter = createPersistenceAdapter("local");

  const result = await adapter.updateAsset(
    "non-existent-id",
    { metadata: { codec: "test" } },
    { correlationId: "test-not-found" }
  );

  assert.equal(result, null, "Should return null for non-existent asset");
});

test("extended asset model: getAssetById returns null for non-existent asset", async () => {
  const adapter = createPersistenceAdapter("local");

  const result = await adapter.getAssetById("non-existent-id");
  assert.equal(result, null, "Should return null for non-existent asset");
});

test("extended asset model: backward compatibility (existing tests pattern)", async () => {
  const adapter = createPersistenceAdapter("local");

  // Standard ingest flow should still work with no extended fields
  const { asset, job } = await adapter.createIngestAsset(
    { title: "legacy.mov", sourceUri: "file:///legacy.mov" },
    { correlationId: "test-compat" }
  );

  assert.ok(asset.id, "Asset should have an ID");
  assert.equal(asset.title, "legacy.mov");
  assert.equal(asset.sourceUri, "file:///legacy.mov");
  assert.ok(asset.createdAt, "Asset should have createdAt");

  // Queue row should still work
  const rows = await adapter.listAssetQueueRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "legacy.mov");

  // Job workflow should be unaffected
  assert.equal(job.status, "pending");
});
