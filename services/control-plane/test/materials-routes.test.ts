/**
 * MaterialX REST Routes Tests
 *
 * Tests the full lifecycle: create material → version → look → bind → dependencies.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/app.js";

const API = "/api/v1";

async function createProject(app: any) {
  // Use the VFX hierarchy persistence directly since we need a project
  const persistence = (app as any).persistence;
  return persistence.createProject(
    { code: "MTLX_TEST", name: "Material Test", type: "feature", status: "active" },
    { correlationId: "test" }
  );
}

test("Material routes: full lifecycle", async () => {
  const app = buildApp();
  const project = await createProject(app);

  // 1. Create material
  const createRes = await app.inject({
    method: "POST",
    url: `${API}/materials`,
    payload: {
      projectId: project.id,
      name: "HeroSkin",
      description: "Hero character skin shader",
      createdBy: "artist@studio.com",
    },
  });
  assert.equal(createRes.statusCode, 201);
  const material = createRes.json();
  assert.equal(material.name, "HeroSkin");
  assert.ok(material.id);

  // 2. Get material
  const getRes = await app.inject({
    method: "GET",
    url: `${API}/materials/${material.id}`,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json().name, "HeroSkin");

  // 3. List materials
  const listRes = await app.inject({
    method: "GET",
    url: `${API}/materials?projectId=${project.id}`,
  });
  assert.equal(listRes.statusCode, 200);
  const materials = listRes.json();
  assert.ok(Array.isArray(materials));
  assert.equal(materials.length, 1);

  // 4. Create material version
  const versionRes = await app.inject({
    method: "POST",
    url: `${API}/materials/${material.id}/versions`,
    payload: {
      versionLabel: "v001",
      sourcePath: "/materials/hero_skin.mtlx",
      contentHash: "sha256:abc123",
      renderContexts: ["arnold"],
      mtlxSpecVersion: "1.38",
    },
  });
  assert.equal(versionRes.statusCode, 201);
  const version = versionRes.json();
  assert.equal(version.versionLabel, "v001");
  assert.ok(version.id);

  // 5. List versions
  const versionsRes = await app.inject({
    method: "GET",
    url: `${API}/materials/${material.id}/versions`,
  });
  assert.equal(versionsRes.statusCode, 200);
  assert.equal(versionsRes.json().length, 1);

  // 6. Get version by ID
  const getVersionRes = await app.inject({
    method: "GET",
    url: `${API}/materials/${material.id}/versions/${version.id}`,
  });
  assert.equal(getVersionRes.statusCode, 200);
  assert.equal(getVersionRes.json().versionLabel, "v001");

  // 7. Create look variant
  const lookRes = await app.inject({
    method: "POST",
    url: `${API}/materials/versions/${version.id}/looks`,
    payload: {
      lookName: "hero",
      description: "Hero look with full detail",
    },
  });
  assert.equal(lookRes.statusCode, 201);
  const look = lookRes.json();
  assert.equal(look.lookName, "hero");

  // 8. List looks
  const looksRes = await app.inject({
    method: "GET",
    url: `${API}/materials/versions/${version.id}/looks`,
  });
  assert.equal(looksRes.statusCode, 200);
  assert.equal(looksRes.json().length, 1);

  // 9. Create a render version to bind to
  const persistence = (app as any).persistence;
  const seq = await persistence.createSequence(
    { projectId: project.id, code: "SEQ010", status: "active" },
    { correlationId: "test" }
  );
  const shot = await persistence.createShot(
    {
      projectId: project.id,
      sequenceId: seq.id,
      code: "SH010",
      status: "active",
      frameRangeStart: 1001,
      frameRangeEnd: 1100,
      frameCount: 100,
    },
    { correlationId: "test" }
  );
  const renderVersion = await persistence.createVersion(
    {
      shotId: shot.id,
      projectId: project.id,
      sequenceId: seq.id,
      versionLabel: "v001",
      status: "draft",
      mediaType: "exr_sequence",
      createdBy: "artist@studio.com",
    },
    { correlationId: "test" }
  );

  // 10. Bind look to render version
  const bindRes = await app.inject({
    method: "POST",
    url: `${API}/materials/looks/${look.id}/bind`,
    payload: {
      versionId: renderVersion.id,
      boundBy: "artist@studio.com",
    },
  });
  assert.equal(bindRes.statusCode, 201);
  const binding = bindRes.json();
  assert.equal(binding.lookVariantId, look.id);
  assert.equal(binding.versionId, renderVersion.id);

  // 11. List bindings by look
  const bindingsRes = await app.inject({
    method: "GET",
    url: `${API}/materials/looks/${look.id}/bindings`,
  });
  assert.equal(bindingsRes.statusCode, 200);
  assert.equal(bindingsRes.json().length, 1);

  // 12. List material bindings by render version
  const versionBindingsRes = await app.inject({
    method: "GET",
    url: `${API}/versions/${renderVersion.id}/material-bindings`,
  });
  assert.equal(versionBindingsRes.statusCode, 200);
  assert.equal(versionBindingsRes.json().length, 1);

  // 13. Create dependency
  const depRes = await app.inject({
    method: "POST",
    url: `${API}/materials/versions/${version.id}/dependencies`,
    payload: {
      texturePath: "/textures/hero_diffuse.exr",
      contentHash: "sha256:def456",
      textureType: "albedo",
      colorspace: "ACEScg",
      dependencyDepth: 0,
    },
  });
  assert.equal(depRes.statusCode, 201);
  const dep = depRes.json();
  assert.equal(dep.texturePath, "/textures/hero_diffuse.exr");

  // 14. List dependencies
  const depsRes = await app.inject({
    method: "GET",
    url: `${API}/materials/versions/${version.id}/dependencies`,
  });
  assert.equal(depsRes.statusCode, 200);
  assert.equal(depsRes.json().length, 1);

  await app.close();
});

test("Material routes: 404 on missing material", async () => {
  const app = buildApp();

  const res = await app.inject({
    method: "GET",
    url: `${API}/materials/nonexistent-id`,
  });
  assert.equal(res.statusCode, 404);
  assert.ok(res.json().error);

  await app.close();
});

test("Material routes: 404 on version for missing material", async () => {
  const app = buildApp();

  const res = await app.inject({
    method: "POST",
    url: `${API}/materials/nonexistent-id/versions`,
    payload: {
      versionLabel: "v001",
      sourcePath: "/test.mtlx",
      contentHash: "sha256:test",
    },
  });
  assert.equal(res.statusCode, 404);
  assert.ok(res.json().error);

  await app.close();
});

test("Material routes: 404 on look for missing version", async () => {
  const app = buildApp();

  const res = await app.inject({
    method: "POST",
    url: `${API}/materials/versions/nonexistent-id/looks`,
    payload: { lookName: "hero" },
  });
  assert.equal(res.statusCode, 404);

  await app.close();
});

test("Material routes: 404 on dependency for missing version", async () => {
  const app = buildApp();

  const res = await app.inject({
    method: "POST",
    url: `${API}/materials/versions/nonexistent-id/dependencies`,
    payload: {
      texturePath: "/tex.exr",
      contentHash: "sha256:test",
      dependencyDepth: 0,
    },
  });
  assert.equal(res.statusCode, 404);

  await app.close();
});
