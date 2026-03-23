import type { FastifyInstance } from "fastify";

import { sendError } from "../http/errors.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { ProjectType, ProjectStatus, SequenceStatus, ShotStatus } from "../domain/models.js";

interface HierarchyNode {
  id: string;
  label: string;
  type: "project" | "sequence" | "shot" | "task" | "version";
  status?: string;
  assignee?: string;
  frame_range?: { start: number; end: number };
  pipeline_stage?: string;
  proxyUri?: string;
  resolution?: string;
  color_space?: string;
  children?: HierarchyNode[];
}

export async function registerHierarchyRoute(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    // GET /hierarchy — full tree
    app.get(
      `${prefix}/hierarchy`,
      {
        schema: {
          tags: ["hierarchy"],
          operationId: `getHierarchy${prefix ? "" : "Legacy"}`,
          summary: "Get full project hierarchy tree",
        },
      },
      async () => {
        const projects = await persistence.listProjects();

        const projectNodes: HierarchyNode[] = [];

        for (const project of projects) {
          const sequences = await persistence.listSequencesByProject(project.id);
          const seqNodes: HierarchyNode[] = [];

          for (const seq of sequences) {
            const shots = await persistence.listShotsBySequence(seq.id);
            const shotNodes: HierarchyNode[] = [];

            for (const shot of shots) {
              const tasks = await persistence.listTasksByShot(shot.id);
              const versions = await persistence.listVersionsByShot(shot.id);

              const taskNodes: HierarchyNode[] = tasks.map((t) => ({
                id: t.id,
                label: t.code,
                type: "task" as const,
                status: t.status,
                assignee: t.assignee ?? undefined,
                pipeline_stage: t.type,
              }));

              const versionNodes: HierarchyNode[] = versions.map((v) => ({
                id: v.id,
                label: v.versionLabel,
                type: "version" as const,
                status: v.status,
                resolution:
                  v.resolutionW && v.resolutionH
                    ? `${v.resolutionW}x${v.resolutionH}`
                    : undefined,
                color_space: v.colorSpace ?? undefined,
                frame_range:
                  v.frameRangeStart != null && v.frameRangeEnd != null
                    ? { start: v.frameRangeStart, end: v.frameRangeEnd }
                    : undefined,
              }));

              shotNodes.push({
                id: shot.id,
                label: shot.code,
                type: "shot",
                status: shot.status,
                frame_range: { start: shot.frameRangeStart, end: shot.frameRangeEnd },
                children: [...taskNodes, ...versionNodes],
              });
            }

            seqNodes.push({
              id: seq.id,
              label: seq.code,
              type: "sequence",
              status: seq.status,
              children: shotNodes,
            });
          }

          projectNodes.push({
            id: project.id,
            label: project.name,
            type: "project",
            status: project.status,
            children: seqNodes,
          });
        }

        return { projects: projectNodes };
      },
    );

    // POST /hierarchy/projects — create a project
    app.post<{
      Body: { name: string; code: string; type?: ProjectType; status?: ProjectStatus };
    }>(
      `${prefix}/hierarchy/projects`,
      {
        schema: {
          tags: ["hierarchy"],
          operationId: `createProject${prefix ? "" : "Legacy"}`,
          summary: "Create a project",
          body: {
            type: "object",
            required: ["name", "code"],
            additionalProperties: false,
            properties: {
              name: { type: "string", minLength: 1 },
              code: { type: "string", minLength: 1 },
              type: { type: "string", enum: ["feature", "episodic", "commercial", "vfx_only"] },
              status: { type: "string", enum: ["active", "archived", "delivered"] },
            },
          },
          response: {
            201: {
              type: "object",
              required: ["project"],
              properties: {
                project: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    type: { type: "string" },
                    status: { type: "string" },
                    children: { type: "array" },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const { name, code, type = "vfx_only", status = "active" } = request.body;
        const project = await persistence.createProject(
          { name, code, type, status },
          { correlationId: request.id }
        );
        const node: HierarchyNode = {
          id: project.id,
          label: project.name,
          type: "project",
          status: project.status,
          children: [],
        };
        return reply.status(201).send({ project: node });
      }
    );

    // POST /hierarchy/projects/:projectId/sequences — create a sequence
    app.post<{
      Params: { projectId: string };
      Body: { code: string; status?: SequenceStatus };
    }>(
      `${prefix}/hierarchy/projects/:projectId/sequences`,
      {
        schema: {
          tags: ["hierarchy"],
          operationId: `createSequence${prefix ? "" : "Legacy"}`,
          summary: "Create a sequence under a project",
          params: {
            type: "object",
            required: ["projectId"],
            properties: { projectId: { type: "string" } },
          },
          body: {
            type: "object",
            required: ["code"],
            additionalProperties: false,
            properties: {
              code: { type: "string", minLength: 1 },
              status: { type: "string", enum: ["active", "locked", "delivered"] },
            },
          },
        },
      },
      async (request, reply) => {
        const { projectId } = request.params;
        const project = await persistence.getProjectById(projectId);
        if (!project) {
          return sendError(request, reply, 404, "NOT_FOUND", "Project not found");
        }
        const { code, status = "active" } = request.body;
        const seq = await persistence.createSequence(
          { projectId, code, status },
          { correlationId: request.id }
        );
        const node: HierarchyNode = {
          id: seq.id,
          label: seq.code,
          type: "sequence",
          status: seq.status,
          children: [],
        };
        return reply.status(201).send({ sequence: node });
      }
    );

    // POST /hierarchy/projects/:projectId/sequences/:sequenceId/shots — create a shot
    app.post<{
      Params: { projectId: string; sequenceId: string };
      Body: {
        code: string;
        status?: ShotStatus;
        frameRangeStart?: number;
        frameRangeEnd?: number;
        frameCount?: number;
      };
    }>(
      `${prefix}/hierarchy/projects/:projectId/sequences/:sequenceId/shots`,
      {
        schema: {
          tags: ["hierarchy"],
          operationId: `createShot${prefix ? "" : "Legacy"}`,
          summary: "Create a shot under a sequence",
          params: {
            type: "object",
            required: ["projectId", "sequenceId"],
            properties: {
              projectId: { type: "string" },
              sequenceId: { type: "string" },
            },
          },
          body: {
            type: "object",
            required: ["code"],
            additionalProperties: false,
            properties: {
              code: { type: "string", minLength: 1 },
              status: { type: "string", enum: ["active", "omit", "locked", "delivered"] },
              frameRangeStart: { type: "number" },
              frameRangeEnd: { type: "number" },
              frameCount: { type: "number" },
            },
          },
        },
      },
      async (request, reply) => {
        const { projectId, sequenceId } = request.params;
        const seq = await persistence.getSequenceById(sequenceId);
        if (!seq) {
          return sendError(request, reply, 404, "NOT_FOUND", "Sequence not found");
        }
        if (seq.projectId !== projectId) {
          return sendError(request, reply, 404, "NOT_FOUND", "Sequence not found in project");
        }
        const {
          code,
          status = "active",
          frameRangeStart = 1001,
          frameRangeEnd = 1100,
          frameCount,
        } = request.body;
        const shot = await persistence.createShot(
          {
            projectId,
            sequenceId,
            code,
            status,
            frameRangeStart,
            frameRangeEnd,
            frameCount: frameCount ?? frameRangeEnd - frameRangeStart + 1,
          },
          { correlationId: request.id }
        );
        const node: HierarchyNode = {
          id: shot.id,
          label: shot.code,
          type: "shot",
          status: shot.status,
          frame_range: { start: shot.frameRangeStart, end: shot.frameRangeEnd },
          children: [],
        };
        return reply.status(201).send({ shot: node });
      }
    );
  }
}
