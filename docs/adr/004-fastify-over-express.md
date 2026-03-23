# ADR-004: Why Fastify over Express

**Status:** Accepted
**Date:** 2026-03-02

## Context

SpaceHarbor's control-plane is a Node.js HTTP service exposing REST APIs, SSE streams, and OpenAPI documentation. The two leading frameworks considered were Express and Fastify.

## Decision

SpaceHarbor uses **Fastify** as the HTTP framework for the control-plane.

Key reasons:

1. **Schema-based validation:** Fastify's built-in JSON Schema validation on request/response provides input validation, OpenAPI generation, and serialization optimization in one mechanism. Express requires separate middleware (e.g., `express-validator`, `joi`).

2. **Performance:** Fastify's internal radix-tree router and schema-based serialization are significantly faster than Express for JSON-heavy workloads (benchmarks show 2-3x throughput improvement).

3. **Plugin architecture:** Fastify's encapsulated plugin system provides clean dependency injection and lifecycle management. Plugins register routes, hooks, and decorators with proper scoping.

4. **TypeScript support:** Fastify has first-class TypeScript support with generic route typing (`RouteHandler<{ Body: T, Reply: R }>`), reducing runtime type errors.

5. **OpenAPI generation:** With `@fastify/swagger`, route schemas automatically generate the OpenAPI spec served at `/openapi.json`. No separate spec maintenance needed.

## Consequences

**Benefits:**
- Input validation and OpenAPI docs are a single source of truth (JSON Schema).
- Strong TypeScript typing reduces bugs at the route handler level.
- Plugin encapsulation keeps route modules isolated and testable.
- SSE support works natively via Fastify's raw response handling.

**Trade-offs:**
- Smaller ecosystem than Express — some Express middleware requires adaptation.
- Plugin encapsulation model has a learning curve (decorators, hooks, scoping).
- JSON Schema syntax can be verbose for complex validation rules.
