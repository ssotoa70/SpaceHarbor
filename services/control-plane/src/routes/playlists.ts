import type { FastifyInstance } from "fastify";
import { withPrefix } from "../http/routes.js";
import { sendError } from "../http/errors.js";
import {
  errorEnvelopeSchema,
  playlistSchema,
  playlistItemSchema,
  playlistsResponseSchema,
  playlistItemsResponseSchema,
  createPlaylistBodySchema,
  addPlaylistItemBodySchema,
  updatePlaylistItemsBodySchema,
  updatePlaylistItemDecisionBodySchema,
  dailiesReportResponseSchema
} from "../http/schemas.js";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { PlaylistItemDecision } from "../domain/models.js";

export async function registerPlaylistRoutes(
  app: FastifyInstance,
  persistence: PersistenceAdapter,
  prefixes: string[]
): Promise<void> {
  for (const prefix of prefixes) {
    const opPrefix = prefix.replace(/\W/g, "") || "root";

    // POST /playlists — create a dailies playlist
    app.post<{
      Body: {
        name: string;
        createdBy: string;
        sessionDate: string;
        description?: string;
      };
      Querystring: { projectId?: string };
    }>(
      withPrefix(prefix, "/playlists"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}CreatePlaylist`,
          summary: "Create a dailies playlist",
          body: createPlaylistBodySchema,
          querystring: {
            type: "object",
            properties: { projectId: { type: "string" } }
          },
          response: {
            201: { type: "object", required: ["playlist"], properties: { playlist: playlistSchema } },
            400: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const projectId = request.query.projectId || "default";
        const { name, createdBy, sessionDate, description } = request.body;
        const playlist = await persistence.createPlaylist(
          { projectId, name, description, createdBy, sessionDate },
          { correlationId: request.id }
        );
        return reply.status(201).send({ playlist });
      }
    );

    // GET /playlists — list playlists for a project
    app.get<{
      Querystring: { projectId?: string };
    }>(
      withPrefix(prefix, "/playlists"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}ListPlaylists`,
          summary: "List playlists for a project",
          querystring: {
            type: "object",
            properties: { projectId: { type: "string" } }
          },
          response: {
            200: playlistsResponseSchema
          }
        }
      },
      async (request, reply) => {
        const projectId = request.query.projectId || "default";
        const playlists = await persistence.listPlaylistsByProject(projectId);
        return reply.send({ playlists });
      }
    );

    // GET /playlists/:id — get a playlist with items
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/playlists/:id"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}GetPlaylist`,
          summary: "Get a playlist with its items",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          response: {
            200: {
              type: "object",
              required: ["playlist", "items"],
              properties: {
                playlist: playlistSchema,
                items: { type: "array", items: playlistItemSchema }
              }
            },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const playlist = await persistence.getPlaylistById(request.params.id);
        if (!playlist) {
          return sendError(request, reply, 404, "NOT_FOUND", "Playlist not found");
        }
        const items = await persistence.listPlaylistItems(playlist.id);
        return reply.send({ playlist, items });
      }
    );

    // POST /playlists/:id/items — add a shot/version to the playlist
    app.post<{
      Params: { id: string };
      Body: {
        shotId: string;
        versionId: string;
        addedBy: string;
        sortOrder?: number;
        notes?: string;
      };
    }>(
      withPrefix(prefix, "/playlists/:id/items"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}AddPlaylistItem`,
          summary: "Add a shot/version to a playlist",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          body: addPlaylistItemBodySchema,
          response: {
            201: { type: "object", required: ["item"], properties: { item: playlistItemSchema } },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const playlist = await persistence.getPlaylistById(request.params.id);
        if (!playlist) {
          return sendError(request, reply, 404, "NOT_FOUND", "Playlist not found");
        }
        const { shotId, versionId, addedBy, sortOrder, notes } = request.body;
        const item = await persistence.addPlaylistItem(
          { playlistId: playlist.id, shotId, versionId, addedBy, sortOrder, notes },
          { correlationId: request.id }
        );
        return reply.status(201).send({ item });
      }
    );

    // PUT /playlists/:id/items — batch update sort order / notes
    app.put<{
      Params: { id: string };
      Body: {
        items: Array<{ id: string; sortOrder?: number; notes?: string }>;
      };
    }>(
      withPrefix(prefix, "/playlists/:id/items"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}UpdatePlaylistItems`,
          summary: "Batch update playlist item ordering and notes",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          body: updatePlaylistItemsBodySchema,
          response: {
            200: playlistItemsResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const playlist = await persistence.getPlaylistById(request.params.id);
        if (!playlist) {
          return sendError(request, reply, 404, "NOT_FOUND", "Playlist not found");
        }
        const updated = await persistence.updatePlaylistItems(
          playlist.id,
          request.body.items,
          { correlationId: request.id }
        );
        return reply.send({ items: updated });
      }
    );

    // PUT /playlists/:playlistId/items/:itemId/decision — record decision
    app.put<{
      Params: { playlistId: string; itemId: string };
      Body: { decision: PlaylistItemDecision; decidedBy: string };
    }>(
      withPrefix(prefix, "/playlists/:playlistId/items/:itemId/decision"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}UpdatePlaylistItemDecision`,
          summary: "Record a dailies decision (approve/reject/hold) for a playlist item",
          params: {
            type: "object",
            required: ["playlistId", "itemId"],
            properties: {
              playlistId: { type: "string" },
              itemId: { type: "string" }
            }
          },
          body: updatePlaylistItemDecisionBodySchema,
          response: {
            200: { type: "object", required: ["item"], properties: { item: playlistItemSchema } },
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const { decision, decidedBy } = request.body;
        const item = await persistence.updatePlaylistItemDecision(
          request.params.itemId,
          { decision, decidedBy },
          { correlationId: request.id }
        );
        if (!item) {
          return sendError(request, reply, 404, "NOT_FOUND", "Playlist item not found");
        }
        return reply.send({ item });
      }
    );

    // GET /playlists/:id/report — export dailies report
    app.get<{ Params: { id: string } }>(
      withPrefix(prefix, "/playlists/:id/report"),
      {
        schema: {
          tags: ["playlists"],
          operationId: `${opPrefix}GetPlaylistReport`,
          summary: "Export dailies notes as structured data",
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" } }
          },
          response: {
            200: dailiesReportResponseSchema,
            404: errorEnvelopeSchema
          }
        }
      },
      async (request, reply) => {
        const playlist = await persistence.getPlaylistById(request.params.id);
        if (!playlist) {
          return sendError(request, reply, 404, "NOT_FOUND", "Playlist not found");
        }
        const entries = await persistence.getPlaylistReport(playlist.id);
        return reply.send({ entries });
      }
    );
  }
}
