# API Versioning Strategy

## Current Version

All SpaceHarbor API endpoints are served under the `/api/v1/` prefix.

## Compatibility Guarantees

### Non-Breaking Changes (No Version Bump)

The following changes are backward-compatible and do **not** require a new API version:

- Adding new optional fields to response bodies
- Adding new optional query parameters
- Adding new endpoints under `/api/v1/`
- Adding new event types to the SSE stream
- Adding new enum values to existing fields (consumers should tolerate unknown values)
- Relaxing validation constraints (e.g., making a required field optional)

### Breaking Changes (Require `/api/v2/`)

The following changes **require** a new API version:

- Removing or renaming existing response fields
- Changing the type of an existing field (e.g., `string` to `number`)
- Adding new **required** request parameters
- Changing the meaning/semantics of an existing field
- Removing an endpoint
- Changing authentication or authorization requirements
- Changing error response format

## Deprecation Policy

When a breaking change is necessary:

1. **Introduce the new version** (`/api/v2/`) alongside the existing version.
2. **Mark the old version as deprecated** in response headers:
   ```
   Deprecation: true
   Sunset: 2026-09-11
   ```
3. **Maintain the deprecated version** for a minimum of **6 months** after the new version ships.
4. **Document the deprecation** in the CHANGELOG and API contracts.
5. **Remove the deprecated version** only after the sunset date and after confirming no active consumers remain.

## Versioning in Practice

### Route Registration

All routes are registered under the `/api/v1/` prefix in the Fastify app:

```typescript
app.register(assetRoutes, { prefix: '/api/v1' });
```

If a v2 is needed, register alongside v1:

```typescript
app.register(assetRoutesV1, { prefix: '/api/v1' });
app.register(assetRoutesV2, { prefix: '/api/v2' });
```

### OpenAPI Schema

Each API version has its own OpenAPI schema. The active schema is served at:

- `GET /openapi.json` (current default version)

### Consumer Guidelines

API consumers should:

- Tolerate unknown fields in responses (forward compatibility)
- Tolerate unknown enum values (forward compatibility)
- Pin to a specific API version in their client configuration
- Monitor `Deprecation` response headers for upcoming changes

## Contributing

All new routes **must** be under `/api/v1/`. Breaking changes require:

1. A versioning discussion with the team
2. An ADR documenting the rationale
3. A migration guide for consumers

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full PR workflow.
