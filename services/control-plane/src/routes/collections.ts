import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import {
  errorEnvelopeSchema,
  collectionSchema,
  collectionItemSchema,
  createCollectionBodySchema,
  addCollectionItemBodySchema,
  collectionsResponseSchema,
  collectionItemsResponseSchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";

export async function registerCollectionRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /collections — create a new collection
    app.post<{
      Params: { projectId: string };
      Body: {
        name: string;
        description?: string;
        collectionType: "playlist" | "selection" | "deliverable";
        ownerId: string;
      };
    }>(
      withPrefix(prefix, "/projects/:projectId/collections"),
      {
        schema: {
          tags: ["collections"],
          operationId: `${opPrefix}CreateCollection`,
          summary: "Create a collection (playlist, selection, or deliverable)",
          body: createCollectionBodySchema,
          response: {
            201: { type: "object", required: ["collection"], properties: { collection: collectionSchema } },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { projectId } = request.params;
        const { name, description, collectionType, ownerId } = request.body;
        const collection = await persistence.createCollection(
          { projectId, name, description, collectionType, ownerId },
          { correlationId: request.id }
        );
        return reply.status(201).send({ collection });
      }
    );

    // GET /projects/:projectId/collections — list collections for a project
    app.get<{
      Params: { projectId: string };
    }>(
      withPrefix(prefix, "/projects/:projectId/collections"),
      {
        schema: {
          tags: ["collections"],
          operationId: `${opPrefix}ListCollections`,
          summary: "List collections for a project",
          response: {
            200: collectionsResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { projectId } = request.params;
        const collections = await persistence.listCollectionsByProject(projectId);
        return reply.send({ collections });
      }
    );

    // POST /collections/:id/items — add an item to a collection
    app.post<{
      Params: { id: string };
      Body: {
        entityType: "asset" | "version" | "shot" | "material";
        entityId: string;
        sortOrder?: number;
        addedBy: string;
        notes?: string;
      };
    }>(
      withPrefix(prefix, "/collections/:id/items"),
      {
        schema: {
          tags: ["collections"],
          operationId: `${opPrefix}AddCollectionItem`,
          summary: "Add an item to a collection",
          body: addCollectionItemBodySchema,
          response: {
            201: { type: "object", required: ["item"], properties: { item: collectionItemSchema } },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { id: collectionId } = request.params;
        const collection = await persistence.getCollectionById(collectionId);
        if (!collection) {
          return reply.status(404).send({ error: "collection not found" });
        }
        const { entityType, entityId, sortOrder, addedBy, notes } = request.body;
        const item = await persistence.addCollectionItem(
          { collectionId, entityType, entityId, sortOrder, addedBy, notes },
          { correlationId: request.id }
        );
        return reply.status(201).send({ item });
      }
    );

    // GET /collections/:id/items — list items in a collection
    app.get<{
      Params: { id: string };
    }>(
      withPrefix(prefix, "/collections/:id/items"),
      {
        schema: {
          tags: ["collections"],
          operationId: `${opPrefix}ListCollectionItems`,
          summary: "List items in a collection",
          response: {
            200: collectionItemsResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { id: collectionId } = request.params;
        const items = await persistence.listCollectionItems(collectionId);
        return reply.send({ items });
      }
    );

    // DELETE /collections/:id/items/:itemId — remove an item from a collection
    app.delete<{
      Params: { id: string; itemId: string };
    }>(
      withPrefix(prefix, "/collections/:id/items/:itemId"),
      {
        schema: {
          tags: ["collections"],
          operationId: `${opPrefix}RemoveCollectionItem`,
          summary: "Remove an item from a collection",
          response: {
            200: { type: "object", required: ["removed"], properties: { removed: { type: "boolean" } } },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { id: collectionId, itemId } = request.params;
        const removed = await persistence.removeCollectionItem(collectionId, itemId);
        if (!removed) {
          return reply.status(404).send({ error: "item not found" });
        }
        return reply.send({ removed: true });
      }
    );
  }
}
