import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { PersistenceAdapter, WriteContext } from "../persistence/types.js";

function ctx(correlationId?: string): WriteContext {
  return { correlationId: correlationId ?? randomUUID() };
}

export async function registerMaterialsRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter
): Promise<void> {
  const prefix = "/api/v1";

  // ── Material CRUD ──────────────────────────────────────────────────────

  app.post(
    `${prefix}/materials`,
    {
      schema: {
        tags: ["materials"],
        operationId: "createMaterial",
        summary: "Create a material",
        body: {
          type: "object",
          required: ["projectId", "name", "createdBy"],
          properties: {
            projectId: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            status: { type: "string", enum: ["active", "deprecated", "archived"] },
            createdBy: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as any;
      const material = await persistence.createMaterial(
        {
          projectId: body.projectId,
          name: body.name,
          description: body.description,
          status: body.status ?? "active",
          createdBy: body.createdBy,
        },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(material);
    }
  );

  app.get(
    `${prefix}/materials`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listMaterials",
        summary: "List materials by project",
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
      },
    },
    async (request) => {
      const { projectId } = request.query as { projectId: string };
      return persistence.listMaterialsByProject(projectId);
    }
  );

  app.get(
    `${prefix}/materials/:materialId`,
    {
      schema: {
        tags: ["materials"],
        operationId: "getMaterial",
        summary: "Get a material by ID",
      },
    },
    async (request, reply) => {
      const { materialId } = request.params as { materialId: string };
      const material = await persistence.getMaterialById(materialId);
      if (!material) return reply.status(404).send({ error: "Material not found" });
      return material;
    }
  );

  // ── MaterialVersion routes ─────────────────────────────────────────────

  app.post(
    `${prefix}/materials/:materialId/versions`,
    {
      schema: {
        tags: ["materials"],
        operationId: "createMaterialVersion",
        summary: "Create a material version",
        body: {
          type: "object",
          required: ["versionLabel", "sourcePath", "contentHash"],
          properties: {
            versionLabel: { type: "string" },
            sourcePath: { type: "string" },
            contentHash: { type: "string" },
            usdMaterialPath: { type: "string" },
            renderContexts: { type: "array", items: { type: "string" } },
            colorspaceConfig: { type: "string" },
            mtlxSpecVersion: { type: "string" },
            lookNames: { type: "array", items: { type: "string" } },
            createdBy: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { materialId } = request.params as { materialId: string };
      const material = await persistence.getMaterialById(materialId);
      if (!material) return reply.status(404).send({ error: "Material not found" });

      const body = request.body as any;
      const version = await persistence.createMaterialVersion(
        {
          materialId,
          versionLabel: body.versionLabel,
          status: "draft",
          sourcePath: body.sourcePath,
          contentHash: body.contentHash,
          usdMaterialPath: body.usdMaterialPath,
          renderContexts: body.renderContexts,
          colorspaceConfig: body.colorspaceConfig,
          mtlxSpecVersion: body.mtlxSpecVersion,
          lookNames: body.lookNames,
          createdBy: body.createdBy ?? "system",
        },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(version);
    }
  );

  app.get(
    `${prefix}/materials/:materialId/versions`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listMaterialVersions",
        summary: "List versions for a material",
      },
    },
    async (request, reply) => {
      const { materialId } = request.params as { materialId: string };
      const material = await persistence.getMaterialById(materialId);
      if (!material) return reply.status(404).send({ error: "Material not found" });
      return persistence.listMaterialVersionsByMaterial(materialId);
    }
  );

  app.get(
    `${prefix}/materials/:materialId/versions/:versionId`,
    {
      schema: {
        tags: ["materials"],
        operationId: "getMaterialVersion",
        summary: "Get a material version by ID",
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const version = await persistence.getMaterialVersionById(versionId);
      if (!version) return reply.status(404).send({ error: "MaterialVersion not found" });
      return version;
    }
  );

  // ── LookVariant routes ─────────────────────────────────────────────────

  app.post(
    `${prefix}/materials/versions/:versionId/looks`,
    {
      schema: {
        tags: ["materials"],
        operationId: "createLookVariant",
        summary: "Create a look variant",
        body: {
          type: "object",
          required: ["lookName"],
          properties: {
            lookName: { type: "string" },
            description: { type: "string" },
            materialAssigns: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const version = await persistence.getMaterialVersionById(versionId);
      if (!version) return reply.status(404).send({ error: "MaterialVersion not found" });

      const body = request.body as any;
      const look = await persistence.createLookVariant(
        {
          materialVersionId: versionId,
          lookName: body.lookName,
          description: body.description,
          materialAssigns: body.materialAssigns,
        },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(look);
    }
  );

  app.get(
    `${prefix}/materials/versions/:versionId/looks`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listLookVariants",
        summary: "List look variants for a material version",
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const version = await persistence.getMaterialVersionById(versionId);
      if (!version) return reply.status(404).send({ error: "MaterialVersion not found" });
      return persistence.listLookVariantsByMaterialVersion(versionId);
    }
  );

  // ── Binding routes ─────────────────────────────────────────────────────

  app.post(
    `${prefix}/materials/looks/:lookVariantId/bind`,
    {
      schema: {
        tags: ["materials"],
        operationId: "bindLookToVersion",
        summary: "Bind a look variant to a render version",
        body: {
          type: "object",
          required: ["versionId", "boundBy"],
          properties: {
            versionId: { type: "string" },
            boundBy: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { lookVariantId } = request.params as { lookVariantId: string };
      const body = request.body as any;
      const binding = await persistence.createVersionMaterialBinding(
        {
          lookVariantId,
          versionId: body.versionId,
          boundBy: body.boundBy,
        },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(binding);
    }
  );

  app.get(
    `${prefix}/materials/looks/:lookVariantId/bindings`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listBindingsByLook",
        summary: "List bindings for a look variant",
      },
    },
    async (request) => {
      const { lookVariantId } = request.params as { lookVariantId: string };
      return persistence.listBindingsByLookVariant(lookVariantId);
    }
  );

  app.get(
    `${prefix}/versions/:versionId/material-bindings`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listMaterialBindingsByVersion",
        summary: "List material bindings for a render version",
      },
    },
    async (request) => {
      const { versionId } = request.params as { versionId: string };
      return persistence.listBindingsByVersion(versionId);
    }
  );

  // ── Dependency routes ──────────────────────────────────────────────────

  app.post(
    `${prefix}/materials/versions/:versionId/dependencies`,
    {
      schema: {
        tags: ["materials"],
        operationId: "createMaterialDependency",
        summary: "Create a texture dependency",
        body: {
          type: "object",
          required: ["texturePath", "contentHash", "dependencyDepth"],
          properties: {
            texturePath: { type: "string" },
            contentHash: { type: "string" },
            textureType: { type: "string" },
            colorspace: { type: "string" },
            dependencyDepth: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const version = await persistence.getMaterialVersionById(versionId);
      if (!version) return reply.status(404).send({ error: "MaterialVersion not found" });

      const body = request.body as any;
      const dep = await persistence.createMaterialDependency(
        {
          materialVersionId: versionId,
          texturePath: body.texturePath,
          contentHash: body.contentHash,
          textureType: body.textureType,
          colorspace: body.colorspace,
          dependencyDepth: body.dependencyDepth,
        },
        ctx(request.headers["x-correlation-id"] as string)
      );
      return reply.status(201).send(dep);
    }
  );

  app.get(
    `${prefix}/materials/versions/:versionId/dependencies`,
    {
      schema: {
        tags: ["materials"],
        operationId: "listMaterialDependencies",
        summary: "List texture dependencies for a material version",
      },
    },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      const version = await persistence.getMaterialVersionById(versionId);
      if (!version) return reply.status(404).send({ error: "MaterialVersion not found" });
      return persistence.listDependenciesByMaterialVersion(versionId);
    }
  );
}
