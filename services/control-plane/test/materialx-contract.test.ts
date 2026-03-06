/**
 * MaterialX Contract Tests
 *
 * Tests the Material → MaterialVersion → LookVariant hierarchy,
 * version-material bindings ("Where Used?"), and dependency tracking.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { LocalPersistenceAdapter } from "../src/persistence/adapters/local-persistence.js";
import { ReferentialIntegrityError } from "../src/persistence/types.js";
import type { VfxHierarchyAdapter, WriteContext } from "../src/persistence/types.js";

const CTX: WriteContext = { correlationId: "mtlx-test" };

function makeAdapters(): Array<{ name: string; adapter: VfxHierarchyAdapter }> {
  return [{ name: "LocalAdapter", adapter: new LocalPersistenceAdapter() }];
}

// Helper: create a project for material tests
async function seedProject(adapter: VfxHierarchyAdapter) {
  return adapter.createProject(
    { code: "MTLX_PROJ", name: "MaterialX Test", type: "feature", status: "active" },
    CTX
  );
}

// Helper: create full hierarchy for binding tests (project → sequence → shot → version)
async function seedVersion(adapter: VfxHierarchyAdapter) {
  const project = await seedProject(adapter);
  const seq = await adapter.createSequence(
    { projectId: project.id, code: "SEQ_010", status: "active" },
    CTX
  );
  const shot = await adapter.createShot(
    {
      projectId: project.id,
      sequenceId: seq.id,
      code: "SH010",
      status: "active",
      frameRangeStart: 1001,
      frameRangeEnd: 1100,
      frameCount: 100
    },
    CTX
  );
  const version = await adapter.createVersion(
    {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: seq.id,
      versionLabel: "v001",
      status: "draft",
      mediaType: "exr_sequence",
      createdBy: "artist@studio.com"
    },
    CTX
  );
  return { project, seq, shot, version };
}

// ---------------------------------------------------------------------------
// Test 1: createMaterial returns Material with UUID
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterial returns Material with generated UUID`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      {
        projectId: project.id,
        name: "hero_char_skin",
        status: "active",
        createdBy: "td@studio.com"
      },
      CTX
    );

    assert.ok(mat.id);
    assert.match(mat.id, /^[0-9a-f-]{36}$/);
    assert.equal(mat.projectId, project.id);
    assert.equal(mat.name, "hero_char_skin");
    assert.equal(mat.status, "active");
    assert.equal(mat.description, null);
    assert.ok(mat.createdAt);
    assert.ok(mat.updatedAt);
  });
}

// ---------------------------------------------------------------------------
// Test 2: createMaterial with non-existent projectId throws
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterial with non-existent projectId throws ReferentialIntegrityError`, async () => {
    await assert.rejects(
      () =>
        adapter.createMaterial(
          {
            projectId: "nonexistent-id",
            name: "bad_mat",
            status: "active",
            createdBy: "td@studio.com"
          },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 3: createMaterialVersion auto-increments versionNumber
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterialVersion auto-increments versionNumber`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "test_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );

    const v1 = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/shows/proj/materials/test_mat_v001.mtlx",
        contentHash: "a".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );
    assert.equal(v1.versionNumber, 1);
    assert.equal(v1.materialId, mat.id);

    const v2 = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v002",
        status: "draft",
        sourcePath: "/shows/proj/materials/test_mat_v002.mtlx",
        contentHash: "b".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );
    assert.equal(v2.versionNumber, 2);
  });
}

// ---------------------------------------------------------------------------
// Test 4: createMaterialVersion with non-existent materialId throws
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterialVersion with non-existent materialId throws`, async () => {
    await assert.rejects(
      () =>
        adapter.createMaterialVersion(
          {
            materialId: "nonexistent",
            versionLabel: "v001",
            status: "draft",
            sourcePath: "/bad.mtlx",
            contentHash: "c".repeat(64),
            createdBy: "td@studio.com"
          },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 5: createMaterialVersion with parentVersionId supports branching
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterialVersion with parentVersionId supports branching`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "branch_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const v1 = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/mat_v001.mtlx",
        contentHash: "d".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );
    const v2 = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v002-crowd",
        parentVersionId: v1.id,
        status: "draft",
        sourcePath: "/mat_v002_crowd.mtlx",
        contentHash: "e".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );

    assert.equal(v2.parentVersionId, v1.id);
    assert.equal(v2.versionNumber, 2);
  });
}

// ---------------------------------------------------------------------------
// Test 6: findMaterialVersionBySourcePathAndHash returns match (idempotency)
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] findMaterialVersionBySourcePathAndHash returns match`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "idem_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const hash = "f".repeat(64);
    const path = "/shows/proj/materials/hero.mtlx";
    await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: path,
        contentHash: hash,
        createdBy: "td@studio.com"
      },
      CTX
    );

    const found = await adapter.findMaterialVersionBySourcePathAndHash(path, hash);
    assert.ok(found);
    assert.equal(found.sourcePath, path);
    assert.equal(found.contentHash, hash);

    const notFound = await adapter.findMaterialVersionBySourcePathAndHash(path, "0".repeat(64));
    assert.equal(notFound, null);
  });
}

// ---------------------------------------------------------------------------
// Test 7: createLookVariant and list by material version
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createLookVariant and listLookVariantsByMaterialVersion`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "look_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const mv = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/look.mtlx",
        contentHash: "1".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );

    const hero = await adapter.createLookVariant(
      { materialVersionId: mv.id, lookName: "hero" },
      CTX
    );
    const wet = await adapter.createLookVariant(
      { materialVersionId: mv.id, lookName: "wet", description: "Rain variant" },
      CTX
    );

    assert.ok(hero.id);
    assert.equal(hero.materialVersionId, mv.id);
    assert.equal(hero.lookName, "hero");

    const looks = await adapter.listLookVariantsByMaterialVersion(mv.id);
    assert.equal(looks.length, 2);
  });
}

// ---------------------------------------------------------------------------
// Test 8: createLookVariant with non-existent materialVersionId throws
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createLookVariant with non-existent materialVersionId throws`, async () => {
    await assert.rejects(
      () => adapter.createLookVariant({ materialVersionId: "bad", lookName: "x" }, CTX),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 9: createVersionMaterialBinding and "Where Used?" queries
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersionMaterialBinding links version to look variant`, async () => {
    const { project, version } = await seedVersion(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "bind_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const mv = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/bind.mtlx",
        contentHash: "2".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );
    const look = await adapter.createLookVariant(
      { materialVersionId: mv.id, lookName: "hero" },
      CTX
    );

    const binding = await adapter.createVersionMaterialBinding(
      { lookVariantId: look.id, versionId: version.id, boundBy: "sup@studio.com" },
      CTX
    );

    assert.ok(binding.id);
    assert.equal(binding.lookVariantId, look.id);
    assert.equal(binding.versionId, version.id);

    // "Where Used?" — by look variant
    const byLook = await adapter.listBindingsByLookVariant(look.id);
    assert.equal(byLook.length, 1);
    assert.equal(byLook[0].versionId, version.id);

    // "Where Used?" — by version
    const byVersion = await adapter.listBindingsByVersion(version.id);
    assert.equal(byVersion.length, 1);
    assert.equal(byVersion[0].lookVariantId, look.id);
  });
}

// ---------------------------------------------------------------------------
// Test 10: createVersionMaterialBinding FK checks
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createVersionMaterialBinding with bad lookVariantId throws`, async () => {
    const { version } = await seedVersion(adapter);
    await assert.rejects(
      () =>
        adapter.createVersionMaterialBinding(
          { lookVariantId: "bad", versionId: version.id, boundBy: "x" },
          CTX
        ),
      ReferentialIntegrityError
    );
  });
}

// ---------------------------------------------------------------------------
// Test 11: createMaterialDependency and list by version
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] createMaterialDependency tracks textures with content hash`, async () => {
    const project = await seedProject(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "dep_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const mv = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/dep.mtlx",
        contentHash: "3".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );

    const dep = await adapter.createMaterialDependency(
      {
        materialVersionId: mv.id,
        texturePath: "/textures/hero_albedo.exr",
        contentHash: "4".repeat(64),
        textureType: "albedo",
        colorspace: "ACEScg",
        dependencyDepth: 0
      },
      CTX
    );

    assert.ok(dep.id);
    assert.equal(dep.materialVersionId, mv.id);
    assert.equal(dep.contentHash, "4".repeat(64));
    assert.equal(dep.dependencyDepth, 0);

    // Transitive dep
    await adapter.createMaterialDependency(
      {
        materialVersionId: mv.id,
        texturePath: "/textures/base_normal.exr",
        contentHash: "5".repeat(64),
        textureType: "normal",
        dependencyDepth: 1
      },
      CTX
    );

    const deps = await adapter.listDependenciesByMaterialVersion(mv.id);
    assert.equal(deps.length, 2);
    assert.equal(deps.filter((d) => d.dependencyDepth === 0).length, 1);
    assert.equal(deps.filter((d) => d.dependencyDepth === 1).length, 1);
  });
}

// ---------------------------------------------------------------------------
// Test 12: countBindingsForMaterial (cascade-delete safety)
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] countBindingsForMaterial returns binding count`, async () => {
    const { project, version } = await seedVersion(adapter);
    const mat = await adapter.createMaterial(
      { projectId: project.id, name: "count_mat", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    const mv = await adapter.createMaterialVersion(
      {
        materialId: mat.id,
        versionLabel: "v001",
        status: "draft",
        sourcePath: "/count.mtlx",
        contentHash: "6".repeat(64),
        createdBy: "td@studio.com"
      },
      CTX
    );
    const look = await adapter.createLookVariant(
      { materialVersionId: mv.id, lookName: "hero" },
      CTX
    );

    // No bindings yet
    assert.equal(await adapter.countBindingsForMaterial(mat.id), 0);

    // Add binding
    await adapter.createVersionMaterialBinding(
      { lookVariantId: look.id, versionId: version.id, boundBy: "sup@studio.com" },
      CTX
    );

    assert.equal(await adapter.countBindingsForMaterial(mat.id), 1);
  });
}

// ---------------------------------------------------------------------------
// Test 13: listMaterialsByProject scopes to project
// ---------------------------------------------------------------------------
for (const { name, adapter } of makeAdapters()) {
  test(`[${name}] listMaterialsByProject scopes to project`, async () => {
    const p1 = await adapter.createProject(
      { code: "P1", name: "P1", type: "feature", status: "active" },
      CTX
    );
    const p2 = await adapter.createProject(
      { code: "P2", name: "P2", type: "feature", status: "active" },
      CTX
    );

    await adapter.createMaterial(
      { projectId: p1.id, name: "mat_a", status: "active", createdBy: "td@studio.com" },
      CTX
    );
    await adapter.createMaterial(
      { projectId: p2.id, name: "mat_b", status: "active", createdBy: "td@studio.com" },
      CTX
    );

    const p1Mats = await adapter.listMaterialsByProject(p1.id);
    assert.equal(p1Mats.length, 1);
    assert.equal(p1Mats[0].name, "mat_a");
  });
}
