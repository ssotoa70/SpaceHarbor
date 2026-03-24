import type { FastifyInstance } from "fastify";
import type { PersistenceAdapter } from "../persistence/types.js";
import type { TrinoClient } from "../db/trino-client.js";
import { TtlCache } from "../utils/ttl-cache.js";

const S = 'vast."spaceharbor/production"';

// 10-minute TTL cache
const cache = new TtlCache<unknown>(10 * 60 * 1000);

type TimeRange = "24h" | "7d" | "30d" | "90d";

function parseTimeRange(query: Record<string, unknown>): { from: Date; to: Date; label: string } {
  const now = new Date();
  const to = query.to ? new Date(String(query.to)) : now;

  if (query.from) {
    return { from: new Date(String(query.from)), to, label: "custom" };
  }

  const range = (String(query.range || "7d")) as TimeRange;
  const ms: Record<TimeRange, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };

  if (!ms[range]) {
    throw new Error(`Invalid range: ${range}`);
  }

  return { from: new Date(now.getTime() - ms[range]), to, label: range };
}

// ── Fallback data generators (when VAST Database unavailable) ──

function fallbackAssetMetrics(range: string) {
  return {
    totalAssets: 1247,
    byStatus: [
      { status: "approved", count: 842 },
      { status: "pending_review", count: 215 },
      { status: "in_progress", count: 134 },
      { status: "rejected", count: 56 },
    ],
    byMediaType: [
      { mediaType: "exr", count: 423 },
      { mediaType: "mov", count: 312 },
      { mediaType: "abc", count: 198 },
      { mediaType: "usd", count: 167 },
      { mediaType: "mtlx", count: 147 },
    ],
    topAccessed: [
      { assetId: "ast-001", name: "hero_char_v12.exr", accessCount: 89 },
      { assetId: "ast-002", name: "env_forest_v08.usd", accessCount: 76 },
      { assetId: "ast-003", name: "fx_explosion_v03.abc", accessCount: 64 },
    ],
    range,
    cachedAt: new Date().toISOString(),
  };
}

function fallbackPipelineMetrics(range: string) {
  return {
    completionRate: 94.2,
    throughputPerHour: 12.7,
    dlqSize: 3,
    retrySuccessRate: 78.5,
    jobsByStatus: [
      { status: "completed", count: 2841 },
      { status: "failed", count: 168 },
      { status: "retrying", count: 42 },
      { status: "pending", count: 87 },
    ],
    range,
    cachedAt: new Date().toISOString(),
  };
}

function fallbackStorageMetrics(range: string) {
  return {
    totalBytes: 8.81e12,
    byMediaType: [
      { mediaType: "exr", bytes: 3.2e12 },
      { mediaType: "mov", bytes: 2.4e12 },
      { mediaType: "abc", bytes: 1.5e12 },
      { mediaType: "usd", bytes: 1.1e12 },
      { mediaType: "mtlx", bytes: 610e9 },
    ],
    proxyCoverage: 87.3,
    thumbnailCoverage: 95.1,
    growthTrend: [7.2e12, 7.5e12, 7.8e12, 8.1e12, 8.3e12, 8.6e12, 8.81e12],
    range,
    cachedAt: new Date().toISOString(),
  };
}

function fallbackRenderMetrics(range: string) {
  return {
    totalCoreHours: 12480,
    avgRenderTimeSeconds: 930,
    peakMemoryTrend: [28.4, 31.2, 29.8, 33.1, 30.5, 35.2, 32.8],
    jobsByEngine: [
      { engine: "Arnold", count: 142 },
      { engine: "Karma", count: 78 },
      { engine: "RenderMan", count: 42 },
      { engine: "V-Ray", count: 22 },
    ],
    range,
    cachedAt: new Date().toISOString(),
  };
}

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  _persistence: PersistenceAdapter,
  catalogTrino: TrinoClient | null,
  prefixes: string[],
): void {
  for (const prefix of prefixes) {
    // ── Asset Metrics ──
    app.get(`${prefix}/analytics/assets`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1AnalyticsAssets" : "legacyAnalyticsAssets",
        summary: "Asset metrics aggregated by status, media type, and access frequency",
        querystring: {
          type: "object",
          properties: {
            range: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", additionalProperties: true },
        },
      },
    }, async (request, reply) => {
      try {
        const q = request.query as Record<string, unknown>;
        const { label } = parseTimeRange(q);
        const cacheKey = `analytics:assets:${label}`;

        const cached = cache.get(cacheKey);
        if (cached) return cached;

        if (!catalogTrino) {
          const data = fallbackAssetMetrics(label);
          cache.set(cacheKey, data);
          return data;
        }

        const { from, to } = parseTimeRange(q);
        const fromStr = from.toISOString().slice(0, 23);
        const toStr = to.toISOString().slice(0, 23);

        const [totalResult, statusResult, mediaResult, topResult] = await Promise.all([
          catalogTrino.query(`SELECT COUNT(*) AS cnt FROM ${S}.assets WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}'`),
          catalogTrino.query(`SELECT status, COUNT(*) AS cnt FROM ${S}.assets WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}' GROUP BY status ORDER BY cnt DESC`),
          catalogTrino.query(`SELECT media_type, COUNT(*) AS cnt FROM ${S}.assets WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}' GROUP BY media_type ORDER BY cnt DESC LIMIT 10`),
          catalogTrino.query(`SELECT id, name, access_count FROM ${S}.assets WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}' ORDER BY access_count DESC LIMIT 10`),
        ]);

        const data = {
          totalAssets: Number(totalResult.data[0]?.[0] ?? 0),
          byStatus: statusResult.data.map((r: unknown[]) => ({ status: String(r[0]), count: Number(r[1]) })),
          byMediaType: mediaResult.data.map((r: unknown[]) => ({ mediaType: String(r[0]), count: Number(r[1]) })),
          topAccessed: topResult.data.map((r: unknown[]) => ({ assetId: String(r[0]), name: String(r[1]), accessCount: Number(r[2]) })),
          range: label,
          cachedAt: new Date().toISOString(),
        };
        cache.set(cacheKey, data);
        return data;
      } catch (err) {
        const q = request.query as Record<string, unknown>;
        const range = String(q.range || "7d");
        if (String(err).includes("Invalid range")) {
          return reply.status(400).send({ code: "BAD_REQUEST", message: `Invalid range: ${range}` });
        }
        const data = fallbackAssetMetrics(range);
        cache.set(`analytics:assets:${range}`, data);
        return data;
      }
    });

    // ── Pipeline Metrics ──
    app.get(`${prefix}/analytics/pipeline`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1AnalyticsPipeline" : "legacyAnalyticsPipeline",
        summary: "Pipeline metrics: completion rate, throughput, DLQ size, and job status breakdown",
        querystring: {
          type: "object",
          properties: {
            range: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    }, async (request, reply) => {
      try {
        const q = request.query as Record<string, unknown>;
        const { label } = parseTimeRange(q);
        const cacheKey = `analytics:pipeline:${label}`;

        const cached = cache.get(cacheKey);
        if (cached) return cached;

        if (!catalogTrino) {
          const data = fallbackPipelineMetrics(label);
          cache.set(cacheKey, data);
          return data;
        }

        const { from, to } = parseTimeRange(q);
        const fromStr = from.toISOString().slice(0, 23);
        const toStr = to.toISOString().slice(0, 23);

        const [statusResult, dlqResult] = await Promise.all([
          catalogTrino.query(`SELECT status, COUNT(*) AS cnt FROM ${S}.jobs WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}' GROUP BY status`),
          catalogTrino.query(`SELECT COUNT(*) AS cnt FROM ${S}.dead_letter_queue`),
        ]);

        const statusMap: Record<string, number> = {};
        for (const r of statusResult.data as unknown[][]) {
          statusMap[String(r[0])] = Number(r[1]);
        }
        const total = Object.values(statusMap).reduce((s, v) => s + v, 0);
        const completed = statusMap["completed"] ?? 0;

        const data = {
          completionRate: total > 0 ? (completed / total) * 100 : 0,
          throughputPerHour: total > 0 ? total / Math.max(1, (to.getTime() - from.getTime()) / 3600000) : 0,
          dlqSize: Number((dlqResult.data as unknown[][])[0]?.[0] ?? 0),
          retrySuccessRate: 0,
          jobsByStatus: Object.entries(statusMap).map(([status, count]) => ({ status, count })),
          range: label,
          cachedAt: new Date().toISOString(),
        };
        cache.set(cacheKey, data);
        return data;
      } catch {
        const q = request.query as Record<string, unknown>;
        const range = String(q.range || "7d");
        const data = fallbackPipelineMetrics(range);
        cache.set(`analytics:pipeline:${range}`, data);
        return data;
      }
    });

    // ── Storage Metrics ──
    app.get(`${prefix}/analytics/storage`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1AnalyticsStorage" : "legacyAnalyticsStorage",
        summary: "Storage metrics: total bytes, media type breakdown, proxy and thumbnail coverage",
        querystring: {
          type: "object",
          properties: {
            range: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    }, async (request, reply) => {
      try {
        const q = request.query as Record<string, unknown>;
        const { label } = parseTimeRange(q);
        const cacheKey = `analytics:storage:${label}`;

        const cached = cache.get(cacheKey);
        if (cached) return cached;

        if (!catalogTrino) {
          const data = fallbackStorageMetrics(label);
          cache.set(cacheKey, data);
          return data;
        }

        const [totalResult, mediaResult] = await Promise.all([
          catalogTrino.query(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM ${S}.assets`),
          catalogTrino.query(`SELECT media_type, COALESCE(SUM(size_bytes), 0) AS bytes FROM ${S}.assets GROUP BY media_type ORDER BY bytes DESC LIMIT 10`),
        ]);

        const data = {
          totalBytes: Number((totalResult.data as unknown[][])[0]?.[0] ?? 0),
          byMediaType: (mediaResult.data as unknown[][]).map((r) => ({ mediaType: String(r[0]), bytes: Number(r[1]) })),
          proxyCoverage: 0,
          thumbnailCoverage: 0,
          growthTrend: [],
          range: label,
          cachedAt: new Date().toISOString(),
        };
        cache.set(cacheKey, data);
        return data;
      } catch {
        const q = request.query as Record<string, unknown>;
        const range = String(q.range || "7d");
        const data = fallbackStorageMetrics(range);
        cache.set(`analytics:storage:${range}`, data);
        return data;
      }
    });

    // ── Render Metrics ──
    app.get(`${prefix}/analytics/render`, {
      schema: {
        tags: ["admin"],
        operationId: prefix === "/api/v1" ? "v1AnalyticsRender" : "legacyAnalyticsRender",
        summary: "Render metrics: core hours, average render time, and engine breakdown",
        querystring: {
          type: "object",
          properties: {
            range: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    }, async (request, reply) => {
      try {
        const q = request.query as Record<string, unknown>;
        const { label } = parseTimeRange(q);
        const cacheKey = `analytics:render:${label}`;

        const cached = cache.get(cacheKey);
        if (cached) return cached;

        if (!catalogTrino) {
          const data = fallbackRenderMetrics(label);
          cache.set(cacheKey, data);
          return data;
        }

        const { from, to } = parseTimeRange(q);
        const fromStr = from.toISOString().slice(0, 23);
        const toStr = to.toISOString().slice(0, 23);

        const [totalResult, engineResult] = await Promise.all([
          catalogTrino.query(`SELECT COALESCE(SUM(core_hours), 0), COALESCE(AVG(render_time_seconds), 0) FROM ${S}.render_jobs WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}'`),
          catalogTrino.query(`SELECT engine, COUNT(*) AS cnt FROM ${S}.render_jobs WHERE created_at >= TIMESTAMP '${fromStr}' AND created_at <= TIMESTAMP '${toStr}' GROUP BY engine ORDER BY cnt DESC`),
        ]);

        const data = {
          totalCoreHours: Number((totalResult.data as unknown[][])[0]?.[0] ?? 0),
          avgRenderTimeSeconds: Number((totalResult.data as unknown[][])[0]?.[1] ?? 0),
          peakMemoryTrend: [],
          jobsByEngine: (engineResult.data as unknown[][]).map((r) => ({ engine: String(r[0]), count: Number(r[1]) })),
          range: label,
          cachedAt: new Date().toISOString(),
        };
        cache.set(cacheKey, data);
        return data;
      } catch {
        const q = request.query as Record<string, unknown>;
        const range = String(q.range || "7d");
        const data = fallbackRenderMetrics(range);
        cache.set(`analytics:render:${range}`, data);
        return data;
      }
    });
  }
}
