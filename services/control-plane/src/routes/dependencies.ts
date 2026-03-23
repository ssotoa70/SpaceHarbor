import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";

function ctx(correlationId?: string): WriteContext {
  return { correlationId: correlationId ?? randomUUID() };
}

export async function registerDependencyRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter
): Promise<void> {
  const prefix = "/api/v1";

  // ── GET /versions/:id/dependencies ─────────────────────────────────────
  // Returns all dependencies where this version is the source entity

  app.get(
    `${prefix}/versions/:id/dependencies`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "getVersionDependencies",
        summary: "Get dependencies for a version",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const dependencies = await persistence.getDependenciesBySource("version", id);
      return { dependencies };
    }
  );

  // ── GET /materials/:id/dependency-graph ─────────────────────────────────
  // Returns full dependency graph for a material (across all versions)

  app.get(
    `${prefix}/materials/:id/dependency-graph`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "getMaterialDependencyGraph",
        summary: "Get full dependency graph for a material",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const material = await persistence.getMaterialById(id);
      if (!material) return reply.status(404).send({ error: "Material not found" });
      const dependencies = await persistence.getDependencyGraphForMaterial(id);
      return { materialId: id, dependencies };
    }
  );

  // ── GET /shots/:id/asset-usage ──────────────────────────────────────────
  // Returns all version usages within a shot

  app.get(
    `${prefix}/shots/:id/asset-usage`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "getShotAssetUsage",
        summary: "Get asset usage for a shot",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const usage = await persistence.getShotUsage(id);
      return { shotId: id, usage };
    }
  );

  // ── GET /versions/:id/impact-analysis ───────────────────────────────────
  // Returns reverse dependencies: who depends on this version, and shot usage

  app.get(
    `${prefix}/versions/:id/impact-analysis`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "getVersionImpactAnalysis",
        summary: "Analyze impact of changing a version",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const [reverseDeps, shotUsage] = await Promise.all([
        persistence.getReverseDependencies("version", id),
        persistence.getVersionUsageAcrossShots(id),
      ]);
      return {
        versionId: id,
        reverseDependencies: reverseDeps,
        shotUsage,
        affectedShotCount: new Set(shotUsage.map((u) => u.shotId)).size,
      };
    }
  );

  // ── POST /dependencies ──────────────────────────────────────────────────
  // Create a dependency edge

  app.post(
    `${prefix}/dependencies`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "createDependency",
        summary: "Create a dependency between entities",
        body: {
          type: "object",
          required: ["sourceEntityType", "sourceEntityId", "targetEntityType", "targetEntityId", "dependencyType", "dependencyStrength"],
          additionalProperties: false,
          properties: {
            sourceEntityType: { type: "string" },
            sourceEntityId: { type: "string" },
            targetEntityType: { type: "string" },
            targetEntityId: { type: "string" },
            dependencyType: { type: "string", enum: ["uses_material", "references_texture", "in_shot", "derived_from_plate", "uses_simulation", "conform_source"] },
            dependencyStrength: { type: "string", enum: ["hard", "soft", "optional"] },
            discoveredBy: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as any;
      const dep = await persistence.createDependency(body, ctx(request.headers["x-correlation-id"] as string));
      return reply.status(201).send(dep);
    }
  );

  // ── POST /shots/:id/asset-usage ─────────────────────────────────────────
  // Record a version usage within a shot

  app.post(
    `${prefix}/shots/:id/asset-usage`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "createShotAssetUsage",
        summary: "Record version usage in a shot",
        body: {
          type: "object",
          required: ["versionId", "usageType"],
          additionalProperties: false,
          properties: {
            versionId: { type: "string" },
            usageType: { type: "string", enum: ["comp_input", "lighting_ref", "plate", "matchmove_data", "fx_cache", "roto_mask"] },
            layerName: { type: "string" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { id: shotId } = request.params as { id: string };
      const body = request.body as any;
      const usage = await persistence.createShotAssetUsage(
        { shotId, ...body },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(usage);
    }
  );

  // ── GET /materials/:id/texture-audit ────────────────────────────────────
  // All texture dependencies across all material versions with content hash history (C.6)

  app.get(
    `${prefix}/materials/:id/texture-audit`,
    {
      schema: {
        tags: ["dependencies"],
        operationId: "getMaterialTextureAudit",
        summary: "Audit all texture dependencies across all versions of a material",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const material = await persistence.getMaterialById(id);
      if (!material) return reply.status(404).send({ error: "Material not found" });

      const versions = await persistence.listMaterialVersionsByMaterial(id);
      const audit: Array<{
        versionId: string;
        versionLabel: string;
        contentHash: string;
        textures: Array<{ texturePath: string; contentHash: string; textureType: string | null; colorspace: string | null; dependencyDepth: number }>;
      }> = [];

      for (const mv of versions) {
        const deps = await persistence.listDependenciesByMaterialVersion(mv.id);
        audit.push({
          versionId: mv.id,
          versionLabel: mv.versionLabel,
          contentHash: mv.contentHash,
          textures: deps.map((d) => ({
            texturePath: d.texturePath,
            contentHash: d.contentHash,
            textureType: d.textureType,
            colorspace: d.colorspace,
            dependencyDepth: d.dependencyDepth,
          })),
        });
      }

      return { materialId: id, materialName: material.name, versions: audit };
    }
  );
}
