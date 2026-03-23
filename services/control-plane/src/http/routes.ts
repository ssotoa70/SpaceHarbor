export function withPrefix(prefix: string, path: string): string {
  if (!prefix) {
    return path;
  }

  return `${prefix}${path}`;
}

// TODO(openapi-deprecation): Routes registered under the empty-string prefix ("") are legacy
// unversioned paths that duplicate the canonical /api/v1 routes. Each schema block in routes
// that iterate over `prefixes` should add `deprecated: prefix !== "/api/v1"` to their schema
// spread so that OpenAPI consumers know to prefer /api/v1. Example pattern:
//
//   schema: {
//     operationId: prefix === "/api/v1" ? "v1GetAsset" : "legacyGetAsset",
//     ...(prefix !== "/api/v1" ? { deprecated: true } : {}),
//     ...
//   }
//
// This must be applied consistently across: assets.ts, ingest.ts, jobs.ts, incident.ts,
// review-sessions.ts, and dcc.ts. Routes registered only at /api/v1 (queue.ts, metrics.ts,
// materials.ts, timelines.ts) are unaffected.
